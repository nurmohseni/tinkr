// a run replaces the session, and what it runs is a pty of its own: the session
// of the connection is another machine's shell, which a test has no way to boot
jest.mock('../pty/Pty', () => ({Pty: jest.fn()}))

// the run's own machinery — the envelope the session prints its value in — is
// not what this is about: what this is about is what the run sets going once its
// value has come back
jest.mock('tinkr-core', () => {
  const actual = jest.requireActual('tinkr-core')

  return {
    ...actual,
    wrapRun: jest.fn(() => ({code: 'the snippet', marker: 'MARKER', start: 'START'})),
    RunResultFilter: jest.fn(() => ({push: jest.fn(() => ({result: {value: 1}}))})),
    runOutput: jest.fn(() => ''),
  }
})

// the history of a connection is the database's, which is not what this is about
jest.mock('../services/history', () => ({appendHistory: jest.fn(() => [])}))

// the project of a connection over ssh is read by a command of its own, and a
// test has no machine to reach: what another machine would answer is what this
// answers with
jest.mock('../remote', () => ({
  exec: jest.fn(),
  quoted: jest.requireActual('../remote').quoted,
}))

const {Pty} = require('../pty/Pty')
const {exec} = require('../remote')
const {createPty} = require('../createPty')
const {readyIndex, clearRemoteIndexes} = require('../services/project')
const {
  setEditorWindow,
  setPtyProcess,
  setBackgroundPtyProcess,
} = require('../processes')

// what the php of the index prints for a project that declares one class
const described = name => JSON.stringify({
  classmap: [name],
  psr4: {'App\\': ['app']},
  files: ['app/Models/Order.php'],
})

describe('a run of a connection', () => {
  const connection = {id: 'remote', path: '/var/www/app', is_over_ssh: true}

  // the data the session printed, as `createPty` handed it to the run's own
  // filter — which answers with the run's value on the first of them
  let printed = []
  let win = null

  beforeEach(() => {
    printed = []
    win = {webContents: {send: jest.fn()}}

    Pty.mockImplementation(() => ({
      connect: jest.fn(),
      input: jest.fn(),
      onData: jest.fn(cb => {
        printed.push(cb)

        return {dispose: jest.fn()}
      }),
      onExit: jest.fn(),
    }))

    exec.mockResolvedValue({stdout: described('App\\Models\\Actor'), stderr: '', code: 0})
    setEditorWindow('remote', win)
  })

  afterEach(() => {
    clearRemoteIndexes()
    exec.mockReset()
    setEditorWindow('remote', null)
    setPtyProcess('remote', null)
    setBackgroundPtyProcess('remote', null)
  })

  test('reads the project again once the run has answered', async () => {
    createPty(connection, 'the snippet')

    // the run is not read beside: the files it is changing are not what it will
    // leave behind, and such a read is the one this would replace
    expect(exec).not.toHaveBeenCalled()

    printed[0]('the value the session printed')

    // the read is the run's own, started where nobody is waiting on it, and what
    // it answers is what the popup is answered out of
    expect(exec).toHaveBeenCalledTimes(1)

    expect(win.webContents.send).toHaveBeenCalledWith('runResult', expect.anything())

    // the read has not answered yet, so the popup has nothing: it is answered out
    // of what has been read, never out of what is being read
    expect(readyIndex(connection)).toBe(null)

    await new Promise(resolve => setImmediate(resolve))

    expect(Array.from(readyIndex(connection).index.get('actor'))).toEqual(['App\\Models\\Actor'])
  })

  test('reads nothing when a session is booted without a run', async () => {
    createPty(connection)

    printed[0]('the output of the session itself')

    expect(exec).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('outputConnection', expect.anything())
  })
})
