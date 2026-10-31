const fs = require('fs')
const os = require('os')
const path = require('path')
const {PassThrough} = require('stream')

const {makeAppDir, removeAppDir, connection} = require('../__fixtures__/app')
const journal = require('../journal')
const {serve} = require('../protocol')
const {createServer} = require('../server')
const target = require('../target')

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-project-'))

afterAll(() => fs.rmSync(project, {recursive: true, force: true}))

const envelope = (fields = {}) => Object.assign({blocks: [], value: 3, error: null, output: ''}, fields)

// a clock the test moves, so durations and the order of sessions are known
const clock = (start = 1760000000000) => {
  let at = start
  const now = () => at

  now.tick = ms => {
    at += ms
  }

  return now
}

describe('the journal of what clients did', () => {
  let dir

  beforeEach(() => {
    dir = makeAppDir({
      connections: {
        shop: connection({id: 'shop', name: 'Shop', path: project}),
        live: connection({id: 'live', name: 'Live Shop', tag: 'production', path: project}),
      },
    })
  })

  afterEach(() => removeAppDir(dir))

  // the whole way a client reaches it: the handshake names the client, and
  // every tool call lands in the session with what it did and where
  test('keeps a session as the client had it, handshake and calls', async () => {
    const now = clock()
    const resolved = target.resolve({connection: 'shop', dataDir: dir})
    const session = journal.open({dataDir: dir, version: '0.4.8', target: resolved, now})
    const answers = [envelope(), envelope({value: null, output: 'hi'})]
    const server = createServer({
      target: resolved,
      version: '0.4.8',
      journal: session,
      run: async () => {
        now.tick(40)

        return answers.shift()
      },
    })
    const input = new PassThrough()
    const output = new PassThrough()
    const replies = []

    output.on('data', chunk => replies.push(...chunk.toString().split('\n').filter(Boolean)))
    serve({server, name: 'tinkr-mcp', version: '0.4.8', input, output})

    const send = async message => {
      const before = replies.length

      input.write(`${JSON.stringify(message)}\n`)

      for (let attempt = 0; attempt < 200 && replies.length === before; attempt++) {
        await new Promise(resolve => setImmediate(resolve))
      }
    }

    await send({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', clientInfo: {name: 'claude-code', version: '2.1.0'}}})
    await send({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'tinkr_run_php', arguments: {code: 'Order::count();', guard: 'rollback'}}})
    await send({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'tinkr_run_php', arguments: {code: 'echo "hi";'}}})
    await send({jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'tinkr_run_php', arguments: {connection: 'live', code: 'User::truncate();'}}})
    await send({jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'tinkr_list_connections', arguments: {}}})

    const [summary] = journal.sessions(dir, {alive: () => true})

    expect(summary).toMatchObject({
      client: {name: 'claude-code', version: '2.1.0'},
      target: {id: 'shop', name: 'Shop', saved: true},
      live: true,
      ended_at: null,
      calls_total: 4,
      threw: 1,
      runs: 3,
      connections: ['Shop', 'Live Shop'],
    })

    const {calls} = journal.session(dir, summary.id, {alive: () => true})

    // newest first
    expect(calls.map(call => [call.tool, call.outcome])).toEqual([
      ['tinkr_list_connections', 'returned'],
      ['tinkr_run_php', 'threw'],
      ['tinkr_run_php', 'printed'],
      ['tinkr_run_php', 'returned'],
    ])
    expect(calls[3]).toMatchObject({code: 'Order::count();', guard: 'rollback', ms: 40, connection: {id: 'shop', tag: 'local'}})
    expect(calls[1]).toMatchObject({
      code: 'User::truncate();',
      connection: {id: 'live', name: 'Live Shop', tag: 'production'},
      // the default mode: the call was refused, and the journal says why it could be
      mode: 'refuse',
      mode_source: 'settings',
    })
    expect(calls[1].error).toMatch(/Live Shop is tagged production/)
    expect(calls[0].connection).toBe(null)

    now.tick(5000)
    session.end()

    const [ended] = journal.sessions(dir, {alive: () => true})

    expect(ended.live).toBe(false)
    expect(ended.ended_at - ended.started_at).toBe(5080)
  })

  test('keeps the mode and a forced guard beside the call it was forced on', () => {
    const now = clock()
    const session = journal.open({dataDir: dir, version: '0.4.8', target: target.resolve({connection: 'shop', dataDir: dir}), now})

    session.begin({client: {name: 'cursor'}})
    session.record({
      tool: 'tinkr_run_php',
      args: {code: "DB::update('update orders set paid = 1');"},
      answer: {content: [], isError: false},
      at: now(),
      connection: {id: 'live', name: 'Live Shop', tag: 'production'},
      mode: 'guarded',
      modeSource: 'settings',
      guard: 'sandbox',
      guardForced: true,
    })

    const {calls} = journal.session(dir, session.id, {alive: () => true})

    expect(calls[0]).toMatchObject({
      code: "DB::update('update orders set paid = 1');",
      // the guard the run went out with, not the one it asked for (none)
      guard: 'sandbox',
      guard_forced: true,
      mode: 'guarded',
      mode_source: 'settings',
    })

    // a run nobody forced keeps what the call asked for, and no forced flag
    session.record({
      tool: 'tinkr_run_php',
      args: {code: '1;', guard: 'rollback'},
      answer: {content: [], isError: false},
      at: now(),
      connection: {id: 'shop', name: 'Shop', tag: 'local'},
    })

    const [plain] = journal.session(dir, session.id, {alive: () => true}).calls

    expect(plain.guard).toBe('rollback')
    expect(plain.guard_forced).toBeUndefined()
    expect(plain.mode).toBeUndefined()
  })

  test('a server no client spoke to leaves no session behind', () => {
    const session = journal.open({dataDir: dir, version: '0.4.8', target: target.resolve({connection: 'shop', dataDir: dir})})

    session.end()

    expect(journal.sessions(dir)).toEqual([])
  })

  test('a session whose process is gone ended when it last wrote', () => {
    const now = clock()
    const session = journal.open({dataDir: dir, version: '0.4.8', target: target.resolve({connection: 'shop', dataDir: dir}), now})

    session.begin({client: {name: 'cursor'}})
    now.tick(1200)
    session.record({tool: 'tinkr_documentation', args: {}, answer: {content: [], isError: false}, at: now()})

    const [summary] = journal.sessions(dir, {alive: () => false})

    expect(summary.live).toBe(false)
    expect(summary.ended_at - summary.started_at).toBe(1200)
  })

  test('keeps the newest sessions, and clears only the ones that ended', () => {
    const now = clock()
    const resolved = target.resolve({connection: 'shop', dataDir: dir})
    const started = []

    for (let index = 0; index <= journal.keptSessions; index++) {
      now.tick(1000)

      const session = journal.open({dataDir: dir, version: '0.4.8', target: resolved, now, pid: index === journal.keptSessions ? 4242 : 1})

      session.begin({client: {name: `client ${index}`}})
      started.push(session.id)
    }

    const kept = journal.sessions(dir, {alive: pid => pid === 4242})

    expect(kept).toHaveLength(journal.keptSessions)
    // newest first, and the very first one is the one that went
    expect(kept[0].id).toBe(started[started.length - 1])
    expect(kept.map(one => one.id)).not.toContain(started[0])

    const left = journal.clear(dir, {alive: pid => pid === 4242})

    expect(left.map(one => one.client.name)).toEqual([`client ${journal.keptSessions}`])
  })

  test('keeps a long call\'s code whole up to its limit, and marks code it had to cut', () => {
    const session = journal.open({dataDir: dir, version: '0.4.8', target: target.resolve({connection: 'shop', dataDir: dir})})
    const answer = {content: [], structuredContent: {value: 1}, isError: false}
    const whole = 'x'.repeat(journal.keptCode)

    session.begin({client: {name: 'cursor'}})
    session.record({tool: 'tinkr_run_php', args: {code: whole}, answer, at: Date.now()})
    session.record({tool: 'tinkr_run_php', args: {code: `${whole}y`}, answer, at: Date.now()})

    const [longer, kept] = journal.session(dir, session.id, {alive: () => true}).calls

    expect(kept.code).toBe(whole)
    expect(kept.code_cut).toBeUndefined()
    expect(longer.code_cut).toBe(true)
  })

  test('reads no file outside its own directory', () => {
    expect(journal.session(dir, '../connections')).toBe(null)
  })
})
