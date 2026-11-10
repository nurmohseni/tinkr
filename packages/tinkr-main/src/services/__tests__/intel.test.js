// the machine a project is read from is not under test here: what a read is given
// — the program, its budget, and what it keeps — is
jest.mock('../../remote', () => ({
  exec: jest.fn(),
  quoted: value => `'${String(value).replace(/'/g, "'\\''")}'`,
}))

jest.mock('../../utils/dataDir', () => ({dataDir: jest.fn(() => null)}))

const fs = require('fs')
const os = require('os')
const path = require('path')
const {gunzipSync} = require('zlib')

const connection = {id: 'local', path: '/var/www/app'}

// the answer a booted read gives for a project with one model in it
const answer = {
  version: 1,
  project: '/var/www/app',
  booted: true,
  models: [{class: 'App\\Models\\User', attributes: [{name: 'id', type: 'integer'}], casts: {}, appends: [], relations: [], scopes: []}],
  classes: {
    'Illuminate\\Support\\Collection': {
      class: 'Illuminate\\Support\\Collection',
      methods: [{name: 'map', static: false, params: ['callable $callback'], returns: 'static', declaring: 'Illuminate\\Support\\Collection'}],
      properties: [],
      constants: [],
    },
  },
  builders: {eloquent: [{name: 'where', params: ['string $column'], returns: '$this'}], query: []},
  facades: {'Illuminate\\Support\\Facades\\Cache': {root: null, doc: '/** @method static mixed get(string $key) */'}},
  config: ['app.name'],
  routes: [{name: 'home', uri: '/'}],
  views: [{name: 'welcome'}],
  translations: ['auth.failed'],
  env: ['APP_KEY'],
  bindings: [{name: 'Illuminate\\Contracts\\Auth\\Factory', kind: 'singleton'}],
  functions: [{name: 'helper', params: [], returns: null, user: true}],
  constants: ['PHP_EOL'],
  own: ['app\\'],
}

// the answer a class read gives for a class the project's read did not carry
const str = {
  class: 'Illuminate\\Support\\Str',
  exists: true,
  kind: 'class',
  methods: [{name: 'slug', static: true, params: ['string $title'], returns: 'string', declaring: 'Illuminate\\Support\\Str'}],
  properties: [],
  constants: [],
}

// the module under test, with the mocks it was just given: a reset registry hands
// out a new `jest.fn` for each of them, and a binding taken before it is stale
const service = () => {
  const intel = require('../intel')

  return {
    intel,
    exec: require('../../remote').exec,
    dataDir: require('../../utils/dataDir').dataDir,
  }
}

// the program inside the `php -r` the read runs, as it travels
const payloadOf = command => {
  const base64 = command.split("base64_decode('")[1].split("')")[0]
  const bytes = Buffer.from(base64, 'base64')

  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8')
}

// the reads write their file without waiting for it, and a test waits for it the
// way the next process does: by asking again
const settle = async (tries = 40) => {
  for (let index = 0; index < tries; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

beforeEach(() => {
  jest.resetModules()
})

describe('the read of a project', () => {
  test('a connection with no machine here is never asked, and holds nothing', async () => {
    const {intel, exec} = service()
    const cloud = {id: 'cloud', is_cloud: true, path: ''}

    expect(await intel.refreshIntel(cloud)).toBe(null)
    expect(intel.readyIntel(cloud)).toBe(null)
    expect(intel.intelStatus(cloud)).toEqual({state: 'none', at: null, counts: null})
    expect(await intel.membersFor(cloud, 'App\\Models\\User')).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })

  test('a connection that runs through an api reads its own checkout, and nothing else', async () => {
    const {intel, exec} = service()
    exec.mockResolvedValue({code: 0, stdout: JSON.stringify(answer)})

    intel.prefetchIntel({id: 'cloud', is_cloud: true, is_over_ssh: true, path: '/var/www/app', host: 'api'})
    await settle(10)

    expect(exec).toHaveBeenCalledTimes(1)
    // nothing of the api is in what the read is asked of: no host, no ssh, no
    // container — the machine here, in the checkout the connection names
    expect(exec.mock.calls[0][0]).toMatchObject({path: '/var/www/app', is_cloud: false, is_over_ssh: false})
  })
})

describe('one read, and what it keeps', () => {
  test('the whole read is one packed program, and what it answered is ready at once', async () => {
    const {intel, exec} = service()
    exec.mockResolvedValue({code: 0, stdout: JSON.stringify(answer)})

    expect(await intel.refreshIntel(connection)).toEqual(answer)

    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][1]).toContain('php -r')
    expect(exec.mock.calls[0][2]).toEqual({maxBuffer: 4 * 1024 * 1024, timeout: 8000})
    const program = payloadOf(exec.mock.calls[0][1])
    expect(program.startsWith('<?php')).toBe(true)
    expect(program).toContain("'facades'")

    expect(intel.readyIntel(connection)).toEqual(answer)
    expect(intel.intelStatus(connection)).toMatchObject({state: 'ready'})
    expect(intel.intelStatus(connection).counts).toEqual({
      models: 1,
      classes: 1,
      facades: 1,
      config: 1,
      routes: 1,
      views: 1,
      functions: 1,
      constants: 1,
      bindings: 1,
    })
  })

  test('a project that has been read is not read again by the next prefetch', async () => {
    const {intel, exec} = service()
    exec.mockResolvedValue({code: 0, stdout: JSON.stringify(answer)})

    await intel.refreshIntel(connection)
    intel.prefetchIntel(connection)
    await settle(5)

    expect(exec).toHaveBeenCalledTimes(1)
  })

  test('the prefetch is the read itself, and a window that asks during it shares it', async () => {
    const {intel, exec} = service()
    let answered = null
    exec.mockImplementation(() => new Promise(resolve => {
      answered = () => resolve({code: 0, stdout: JSON.stringify(answer)})
    }))

    // the first name typed into a window is answered from the read that window
    // started, so the prefetch hands the read back rather than dropping it
    const first = intel.prefetchIntel(connection)
    const second = intel.prefetchIntel(connection)

    expect(first).toBeInstanceOf(Promise)
    expect(second).toBe(first)

    answered()

    expect(await first).toEqual(answer)
    expect(await second).toEqual(answer)
    expect(exec).toHaveBeenCalledTimes(1)

    // and a project that is read has nothing to hand back: it is already there
    expect(intel.prefetchIntel(connection)).toBe(null)
  })

  test('a machine that did not answer has no read to hand back either', async () => {
    const {intel, exec} = service()
    exec.mockResolvedValue({code: 255, stdout: '', stderr: ''})

    await intel.refreshIntel(connection)

    // the backoff is what keeps the next window from asking a second time, and a
    // caller that would wait for the read is told there is none
    expect(intel.prefetchIntel(connection)).toBe(null)
  })

  test('two calls while a read is running share the one read', async () => {
    const {intel, exec} = service()
    let answered = null
    exec.mockImplementation(() => new Promise(resolve => {
      answered = () => resolve({code: 0, stdout: JSON.stringify(answer)})
    }))

    const first = intel.refreshIntel(connection)
    const second = intel.refreshIntel(connection)
    answered()

    expect(await Promise.all([first, second])).toEqual([answer, answer])
    expect(exec).toHaveBeenCalledTimes(1)
  })

  test('a read that did not answer keeps what the project held, and is not thrown away', async () => {
    const {intel, exec} = service()
    exec.mockResolvedValue({code: 0, stdout: JSON.stringify(answer)})
    await intel.refreshIntel(connection)

    // a warning printed over an answer is not an answer: what the project held a
    // minute ago is worth more than an empty popup
    exec.mockResolvedValue({code: 0, stdout: 'Warning: something\n'})

    expect(await intel.refreshIntel(connection)).toEqual(answer)
    expect(intel.readyIntel(connection)).toEqual(answer)
    expect(intel.intelStatus(connection).state).toBe('ready')
  })

  test('a machine that answers nothing at all is a failed read, not an empty project', async () => {
    const {intel, exec} = service()
    exec.mockResolvedValue({code: 255, stdout: '', stderr: 'php not found'})

    expect(await intel.refreshIntel(connection)).toBe(null)
    expect(intel.readyIntel(connection)).toBe(null)
    expect(intel.intelStatus(connection)).toMatchObject({state: 'failed', error: 'the project did not answer'})
  })

  test('a read that throws is a failed read, and does not take the service down', async () => {
    const {intel, exec} = service()
    exec.mockRejectedValue(new Error('the link dropped'))

    expect(await intel.refreshIntel(connection)).toBe(null)
    expect(intel.intelStatus(connection)).toMatchObject({state: 'failed', error: 'the link dropped'})
  })

  test('a failed read is not asked again by the next window opened on it', async () => {
    const {intel, exec} = service()
    exec.mockResolvedValue({code: 255, stdout: '', stderr: ''})

    await intel.refreshIntel(connection)
    intel.prefetchIntel(connection)
    await settle(5)

    expect(exec).toHaveBeenCalledTimes(1)
  })

  test('a php without zlib is told so once, and the program travels unpacked', async () => {
    const {intel, exec} = service()
    exec
      .mockResolvedValueOnce({code: 0, stdout: 'tinkr-no-zlib'})
      .mockResolvedValueOnce({code: 0, stdout: JSON.stringify(answer)})

    expect(await intel.refreshIntel(connection)).toEqual(answer)
    expect(exec).toHaveBeenCalledTimes(2)
    // the second payload is the program itself, and the read still works
    expect(payloadOf(exec.mock.calls[1][1]).startsWith('<?php')).toBe(true)
  })

  test('the read of the last process is the read of this one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-intel-'))
    const first = service()
    first.dataDir.mockReturnValue(dir)
    first.exec.mockResolvedValue({code: 0, stdout: JSON.stringify(answer)})

    try {
      await first.intel.refreshIntel(connection)
      await settle()

      // a new process has nothing in memory, and the file the last one left is
      // the answer to the first keystroke
      jest.resetModules()
      const fresh = service()
      fresh.dataDir.mockReturnValue(dir)
      expect(fresh.intel.readyIntel(connection)).toEqual(answer)
      expect(fresh.intel.intelStatus(connection).state).toBe('ready')
      expect(fresh.exec).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  test('a file that is not a read is a cache that is not there', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-intel-'))
    const first = service()
    first.dataDir.mockReturnValue(dir)
    first.exec.mockResolvedValue({code: 0, stdout: JSON.stringify(answer)})

    try {
      await first.intel.refreshIntel(connection)
      await settle()

      const kept = fs.readdirSync(path.join(dir, 'intel'))
      fs.writeFileSync(path.join(dir, 'intel', kept[0]), 'not gzip at all')

      jest.resetModules()
      expect(service().intel.readyIntel(connection)).toBe(null)
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })
})

describe('a class the read did not carry', () => {
  const loaded = async () => {
    const started = service()
    started.exec.mockResolvedValueOnce({code: 0, stdout: JSON.stringify(answer)})
    await started.intel.refreshIntel(connection)

    return started
  }

  test('the read answers a class it carries without asking the machine again', async () => {
    const {intel, exec} = await loaded()

    const members = await intel.membersFor(connection, 'Illuminate\\Support\\Collection')

    expect(members.map(member => member.name)).toEqual(['map'])
    expect(exec).toHaveBeenCalledTimes(1)
  })

  test('a class it does not carry is read once, and kept for the session', async () => {
    const {intel, exec} = await loaded()
    exec.mockResolvedValueOnce({code: 0, stdout: JSON.stringify(str)})

    const members = await intel.membersFor(connection, 'Str', {static: true})

    expect(members.map(member => member.name)).toEqual(['slug'])
    expect(exec).toHaveBeenCalledTimes(2)
    expect(payloadOf(exec.mock.calls[1][1])).toContain("$tinkr_name = 'Illuminate\\\\Support\\\\Str';")

    // the keystroke after it costs nothing, and a caller that cannot wait has the
    // same list
    expect(await intel.membersFor(connection, 'Str', {static: true})).toHaveLength(1)
    expect(intel.readyMembers(connection, 'Str', {static: true}).map(member => member.name)).toEqual(['slug'])
    expect(exec).toHaveBeenCalledTimes(2)
  })

  test('a class that is nowhere is asked about once, and answers nothing', async () => {
    const {intel, exec} = await loaded()
    exec.mockResolvedValue({code: 0, stdout: JSON.stringify({class: 'Nope\\Thing', exists: false})})

    expect(await intel.membersFor(connection, 'Nope\\Thing')).toEqual([])
    expect(exec).toHaveBeenCalledTimes(2)

    expect(await intel.membersFor(connection, 'Nope\\Thing')).toEqual([])
    expect(exec).toHaveBeenCalledTimes(2)
  })

  test('a connection with no read holds no members, and asks nothing', async () => {
    const {intel, exec} = service()

    expect(await intel.membersFor(connection, 'App\\Models\\User')).toEqual([])
    expect(intel.readyMembers(connection, 'App\\Models\\User')).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })
})
