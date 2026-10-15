const {PassThrough} = require('stream')

const {serve, latest} = require('../protocol')
const {createServer} = require('../server')
const target = require('../target')

// a run that answers without a session, so what is tested here is the
// conversation rather than the code that runs in a project
const envelope = {blocks: [{line: 1, value: 3, error: null}], value: 3, error: null, output: ''}

const open = ({run = async () => envelope, onEnd} = {}) => {
  const server = createServer({
    target: target.resolve({at: '/tmp/project', dataDir: '/nowhere'}),
    version: '1.2.3',
    timeout: 60000,
    run,
  })

  const input = new PassThrough()
  const output = new PassThrough()
  const messages = []
  const waiters = []

  output.on('data', chunk => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim() === '') {
        continue
      }

      messages.push(JSON.parse(line))

      for (const waiter of waiters.splice(0)) {
        waiter()
      }
    }
  })

  const connection = serve({server, name: 'tinkr-mcp', version: '1.2.3', input, output, onEnd})

  return {
    server,
    input,
    messages,
    connection,
    send: message => input.write(`${JSON.stringify(message)}\n`),
    async take() {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (messages.length) {
          return messages.shift()
        }

        await new Promise(resolve => setImmediate(resolve))
      }

      throw new Error('the server did not answer')
    },
  }
}

const initialize = (protocolVersion = latest) => ({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion}})

describe('the mcp conversation', () => {
  test('answers the handshake with the revision asked for, and what it can do', async () => {
    const client = open()

    client.send(initialize('2025-03-26'))

    const answer = await client.take()

    expect(answer).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: {tools: {}},
        serverInfo: {name: 'tinkr-mcp', version: '1.2.3'},
      },
    })
    expect(answer.result.instructions).toMatch(/runs PHP in a project/)
  })

  test('answers a revision it does not know with the newest one it does', async () => {
    const client = open()

    client.send(initialize('1999-01-01'))

    expect((await client.take()).result.protocolVersion).toBe(latest)
  })

  test('lists every tool with what it is and what it takes', async () => {
    const client = open()

    client.send({jsonrpc: '2.0', id: 2, method: 'tools/list'})

    const {result} = await client.take()

    expect(result.tools.map(tool => tool.name)).toEqual([
      'tinkr_run_php',
      'tinkr_run_php_over_ssh',
      'tinkr_list_history',
      'tinkr_read_run',
      'tinkr_list_connections',
      'tinkr_list_snippets',
      'tinkr_save_snippet',
    ])

    for (const tool of result.tools) {
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  test('hands a call to the tool it names, with its arguments', async () => {
    const seen = []
    const client = open({
      run: async (connection, code) => {
        seen.push(code)

        return envelope
      },
    })

    client.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {name: 'tinkr_run_php', arguments: {code: '1;'}},
    })

    const answer = await client.take()

    expect(seen).toEqual(['1;'])
    expect(answer.result.content[0].text).toBe('Line 1: 3')
    expect(answer.result.isError).toBe(false)
  })

  test('refuses a tool it does not have', async () => {
    const client = open()

    client.send({jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'tinkr_nope', arguments: {}}})

    expect(await client.take()).toMatchObject({id: 4, error: {code: -32602}})
  })

  test('refuses a method it does not have', async () => {
    const client = open()

    client.send({jsonrpc: '2.0', id: 5, method: 'resources/list'})

    expect(await client.take()).toMatchObject({id: 5, error: {code: -32601}})
  })

  test('answers a line that is not a message with a parse error', async () => {
    const client = open()

    client.input.write('not json at all\n')

    expect(await client.take()).toMatchObject({id: null, error: {code: -32700}})
  })

  test('answers a ping', async () => {
    const client = open()

    client.send({jsonrpc: '2.0', id: 6, method: 'ping'})

    expect((await client.take()).result).toEqual({})
  })

  test('does not answer a notification', async () => {
    const client = open()

    client.send({jsonrpc: '2.0', method: 'notifications/initialized'})
    client.send({jsonrpc: '2.0', id: 7, method: 'ping'})

    // the ping is the first thing that comes back, so nothing answered the
    // notification before it
    expect(await client.take()).toMatchObject({id: 7})
    expect(client.messages).toEqual([])
  })

  test('reads a message split across chunks, and two messages in one chunk', async () => {
    const client = open()
    const message = `${JSON.stringify(initialize())}\n${JSON.stringify({jsonrpc: '2.0', id: 8, method: 'ping'})}\n`
    const half = Math.floor(message.length / 3)

    client.input.write(message.slice(0, half))
    client.input.write(message.slice(half))

    expect((await client.take()).id).toBe(1)
    expect((await client.take()).id).toBe(8)
  })

  test('stops when the client goes away', async () => {
    const onEnd = jest.fn()
    const client = open({onEnd})

    client.input.end()

    await new Promise(resolve => setImmediate(resolve))

    expect(onEnd).toHaveBeenCalled()
  })
})
