/**
 * The conversation with an MCP client, over stdio.
 *
 * MCP is JSON-RPC 2.0, one message per line, and a server that only offers
 * tools has a small part of it to answer: the handshake, the tool list, a tool
 * call, and a ping. That is written out here rather than pulled in with a
 * framework, because the framework is a tree of packages — an http stack, an
 * auth stack, a schema library — for a server that writes five methods'
 * answers to one pipe.
 *
 * stdout carries the protocol and nothing else: a stray line of logging in it is
 * a message the client cannot parse. Everything this server says about itself
 * goes to stderr.
 */
const protocolVersions = ['2025-06-18', '2025-03-26', '2024-11-05']

const latest = protocolVersions[0]

const jsonRpc = '2.0'

/**
 * @param {{server: Object, name: String, version: String, input?: Object,
 *   output?: Object, onEnd?: Function}} options `server` is server.createServer's
 *   answer: its tools, its call, and what it says about itself
 * @return {{stop: Function}}
 */
const serve = ({server, name, version, input = process.stdin, output = process.stdout, onEnd}) => {
  let buffer = ''
  let closed = false

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

  const respond = (id, result) => write({jsonrpc: jsonRpc, id, result})

  const fail = (id, code, message) => write({jsonrpc: jsonRpc, id, error: {code, message}})

  /**
   * @param {String} method
   * @param {Object} params
   * @return {Promise<Object>} what the method answers with. A notification's
   * answer is never sent, whatever it is
   */
  const dispatch = async (method, params) => {
    switch (method) {
      case 'initialize':
        return {
          // the client asks for the revision it speaks; a revision this server
          // does not know is answered with the one it does, and the client
          // decides whether that is good enough
          protocolVersion: protocolVersions.includes(params.protocolVersion) ? params.protocolVersion : latest,
          capabilities: {tools: {}},
          serverInfo: {name, version},
          instructions: server.instructions,
        }

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null

      case 'ping':
        return {}

      case 'tools/list':
        return {tools: server.tools}

      case 'tools/call':
        return server.call(params.name, params.arguments || {})

      default:
        throw Object.assign(new Error(`Unknown method: ${method}`), {code: -32601})
    }
  }

  /**
   * @param {String} line one message
   */
  const handle = async line => {
    let message

    try {
      message = JSON.parse(line)
    } catch (e) {
      fail(null, -32700, 'Parse error')

      return
    }

    if (!message || typeof message.method !== 'string') {
      fail(message && message.id !== undefined ? message.id : null, -32600, 'Invalid Request')

      return
    }

    // a message without an id is a notification: it is done, not answered
    const notification = message.id === undefined

    try {
      const result = await dispatch(message.method, message.params || {})

      if (!notification) {
        respond(message.id, result)
      }
    } catch (e) {
      if (notification) {
        return
      }

      fail(message.id, e.code || -32603, e.message)
    }
  }

  const onData = chunk => {
    buffer += chunk

    const lines = buffer.split('\n')

    // the last piece is a message that has not finished arriving
    buffer = lines.pop()

    for (const line of lines) {
      const message = line.replace(/\r$/, '').trim()

      if (message !== '') {
        handle(message)
      }
    }
  }

  const stop = () => {
    if (closed) {
      return
    }

    closed = true
    input.removeListener('data', onData)
    input.removeListener('end', stop)

    if (onEnd) {
      onEnd()
    }
  }

  input.setEncoding('utf8')
  input.on('data', onData)
  input.on('end', stop)

  return {stop}
}

module.exports = {
  protocolVersions,
  latest,
  serve,
}
