const {said} = require('./target')

/**
 * The conversation with an MCP client, over stdio.
 *
 * MCP is JSON-RPC 2.0, one message per line, and a server that only offers
 * tools has a small part of it to answer: the handshake, the tool list, a tool
 * call, a ping, and a cancellation. That is written out here rather than pulled
 * in with a framework, because the framework is a tree of packages — an http
 * stack, an auth stack, a schema library — for a server that writes a handful of
 * methods' answers to one pipe.
 *
 * stdout carries the protocol and nothing else: a stray line of logging in it is
 * a message the client cannot parse. Everything this server says about itself
 * goes to stderr.
 */
const protocolVersions = ['2025-06-18', '2025-03-26', '2024-11-05']

const latest = protocolVersions[0]

// the one revision that lets a client send several messages as one array: it
// was added in 2025-03-26 and taken out again in the revision after it
const batchVersions = ['2025-03-26']

const jsonRpc = '2.0'

// how long the server waits, once it is told to stop, for the runs it is
// stopping to be stopped: a run's session is killed through its terminal, and a
// session in a container takes a moment to go
const stopWait = 5000

/**
 * @param {any} id
 * @return {Boolean} whether it is an id a request can have: MCP takes JSON-RPC's
 * strings and numbers, and not its null
 */
const validId = id => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))

/**
 * @param {any} value
 * @return {Boolean}
 */
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * @param {Number} code
 * @param {String} message
 * @return {Error}
 */
const rpcError = (code, message) => Object.assign(new Error(message), {code})

/**
 * @param {{server: Object, name: String, version: String, input?: Object,
 *   output?: Object, onEnd?: Function}} options `server` is server.createServer's
 *   answer: its tools, its call, and what it says about itself
 * @return {{stop: Function}} `stop` answers once the calls that were running
 * have been stopped
 */
const serve = ({server, name, version, input = process.stdin, output = process.stdout, onEnd}) => {
  // the pieces of a line that has not finished arriving: kept apart and joined
  // once, because a line of many megabytes appended to a string chunk by chunk
  // and split again every time is read in quadratic time, and nothing else is
  // answered meanwhile
  let pending = []
  let closed = false
  let stopping = null
  let negotiated = null

  // the requests that are being answered, by id, so a cancellation can find the
  // one it is for
  const inFlight = new Map()
  // every message that is still being handled, so stopping can wait for them
  const handling = new Set()

  const keyOf = id => `${typeof id}:${id}`

  const write = message => {
    if (closed) {
      return
    }

    try {
      output.write(`${JSON.stringify(message)}\n`)
    } catch (e) {
      // the client is gone: there is nobody left to answer
      closed = true
    }
  }

  const response = (id, result) => ({jsonrpc: jsonRpc, id, result})

  const failure = (id, code, message) => ({jsonrpc: jsonRpc, id, error: {code, message}})

  /**
   * @param {String} method
   * @param {Object} params
   * @param {AbortSignal} signal aborted when the client cancels the request
   * @return {Promise<Object>} what the method answers with. A notification's
   * answer is never sent, whatever it is
   */
  const dispatch = async (method, params, signal) => {
    switch (method) {
      case 'initialize':
        // the client asks for the revision it speaks; a revision this server
        // does not know is answered with the one it does, and the client
        // decides whether that is good enough
        negotiated = protocolVersions.includes(params.protocolVersion) ? params.protocolVersion : latest

        return {
          protocolVersion: negotiated,
          capabilities: {tools: {}},
          serverInfo: {name, version},
          instructions: server.instructions,
        }

      case 'notifications/initialized':
        return null

      case 'ping':
        return {}

      case 'tools/list':
        return {tools: server.tools}

      case 'tools/call': {
        if (typeof params.name !== 'string') {
          throw rpcError(-32602, '`name` is required: the tool to call.')
        }

        const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments

        if (!isObject(args)) {
          throw rpcError(-32602, '`arguments` has to be an object.')
        }

        return server.call(params.name, args, {signal})
      }

      default:
        throw rpcError(-32601, `Unknown method: ${said(method)}`)
    }
  }

  /**
   * One message, and the answer it gets.
   *
   * @param {any} message
   * @param {Boolean} inBatch
   * @return {Promise<Object|null>} the answer, or nothing when the message is
   * not answered: a notification, a cancelled request, or a client's own answer
   */
  const handle = async (message, inBatch) => {
    if (!isObject(message)) {
      return failure(null, -32600, 'Invalid Request')
    }

    // the answer to a request: this server sends none, so there is nothing it
    // can be the answer to, and an answer is never answered
    if (message.method === undefined && ('result' in message || 'error' in message)) {
      return null
    }

    const notification = !('id' in message)

    if (!notification && !validId(message.id)) {
      return failure(null, -32600, 'Invalid Request: an id is a string or a number')
    }

    if (typeof message.method !== 'string') {
      return notification ? null : failure(message.id, -32600, 'Invalid Request')
    }

    const params = isObject(message.params) ? message.params : {}

    if (message.method === 'notifications/cancelled') {
      const running = inFlight.get(keyOf(params.requestId))

      if (running) {
        running.cancelled = true
        running.controller.abort()
      }

      return null
    }

    if (inBatch && message.method === 'initialize') {
      return notification ? null : failure(message.id, -32600, 'Invalid Request: initialize cannot be part of a batch')
    }

    if (notification) {
      try {
        await dispatch(message.method, params, new AbortController().signal)
      } catch (e) {
      }

      return null
    }

    const running = {controller: new AbortController(), cancelled: false}
    const key = keyOf(message.id)

    inFlight.set(key, running)

    try {
      const result = await dispatch(message.method, params, running.controller.signal)

      // a request the client cancelled is not answered: the client has stopped
      // waiting, and may have reused the id
      return running.cancelled ? null : response(message.id, result)
    } catch (e) {
      return running.cancelled ? null : failure(message.id, e.code || -32603, e.message)
    } finally {
      if (inFlight.get(key) === running) {
        inFlight.delete(key)
      }
    }
  }

  /**
   * @param {String} line one message, or a batch of them
   */
  const handleLine = async line => {
    let message

    try {
      message = JSON.parse(line)
    } catch (e) {
      write(failure(null, -32700, 'Parse error'))

      return
    }

    if (!Array.isArray(message)) {
      const answer = await handle(message, false)

      if (answer) {
        write(answer)
      }

      return
    }

    if (!batchVersions.includes(negotiated)) {
      write(failure(null, -32600, `Invalid Request: protocol revision ${negotiated || latest} has no batches`))

      return
    }

    if (message.length === 0) {
      write(failure(null, -32600, 'Invalid Request'))

      return
    }

    const answers = (await Promise.all(message.map(one => handle(one, true)))).filter(Boolean)

    // a batch of notifications is answered with nothing at all, not with an
    // empty array
    if (answers.length) {
      write(answers)
    }
  }

  const track = line => {
    const handled = handleLine(line).catch(() => {})

    handling.add(handled)
    handled.then(() => handling.delete(handled))
  }

  const onData = chunk => {
    let start = 0
    let end = chunk.indexOf('\n')

    while (end !== -1) {
      pending.push(chunk.slice(start, end))

      const message = pending.join('').replace(/\r$/, '').trim()

      pending = []

      if (message !== '') {
        track(message)
      }

      start = end + 1
      end = chunk.indexOf('\n', start)
    }

    if (start < chunk.length) {
      pending.push(chunk.slice(start))
    }
  }

  /**
   * Stop: no more messages are read, every call that is still running is
   * cancelled — which kills its session, and the php in it — and once they have
   * stopped, or have been given long enough to, the server is done.
   *
   * @return {Promise<void>}
   */
  const stop = () => {
    if (stopping) {
      return stopping
    }

    input.removeListener('data', onData)
    input.removeListener('end', stop)

    for (const running of inFlight.values()) {
      running.cancelled = true
      running.controller.abort()
    }

    let timer = null

    stopping = Promise.race([
      Promise.allSettled([...handling]),
      new Promise(resolve => {
        timer = setTimeout(resolve, stopWait)
      }),
    ]).then(() => {
      clearTimeout(timer)
      closed = true

      if (onEnd) {
        onEnd()
      }
    })

    return stopping
  }

  input.setEncoding('utf8')
  input.on('data', onData)
  input.on('end', stop)

  // a client that closes its end of stdout makes every later write an error
  // event, and one nobody listens for ends the process before its sessions are
  // killed
  if (typeof output.on === 'function') {
    output.on('error', () => {
      closed = true
    })
  }

  return {stop}
}

module.exports = {
  protocolVersions,
  latest,
  stopWait,
  serve,
}
