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
    // a cloud run is the API's, and the tests that override this are about what
    // the window is told of it; the rest of them answer with the real protocol,
    // which rejects for a connection with no token before it reaches the network
    runCloud: jest.fn((...args) => actual.runCloud(...args)),
  }
})

// the history of a connection is the database's, which is not what this is about
jest.mock('../services/history', () => ({appendHistory: jest.fn(() => [])}))

// the token a cloud run is given is the main process's secret, and a test has no
// secrets file: what the app would have saved is what this answers with
jest.mock('../database/secrets', () => ({cloudToken: jest.fn(() => 'a-cloud-token')}))

// the project of a connection over ssh is read by a command of its own, and a
// test has no machine to reach: what another machine would answer is what this
// answers with
jest.mock('../remote', () => ({
  exec: jest.fn(),
  quoted: jest.requireActual('../remote').quoted,
}))

const {runCloud, wrapRun, runOutput, typedRun, SessionError, RunResultFilter} = require('tinkr-core')

const {Pty} = require('../pty/Pty')
const {exec} = require('../remote')
const {createPty} = require('../createPty')
const {appendHistory} = require('../services/history')
const secrets = require('../database/secrets')
const {readyIndex, clearRemoteIndexes} = require('../services/project')
const {
  setEditorWindow,
  setPtyProcess,
  getPtyProcess,
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

    wrapRun.mockClear()
    runOutput.mockClear()
    appendHistory.mockClear()

    Pty.mockImplementation(() => ({
      connect: jest.fn(),
      type: jest.fn(() => Promise.resolve()),
      ready: jest.fn(() => Promise.resolve()),
      onData: jest.fn(cb => {
        printed.push(cb)

        return {dispose: jest.fn()}
      }),
      onExit: jest.fn(),
      onCommandExit: jest.fn(),
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

  test('reads the project for the classes the run names before the session gets it', async () => {
    createPty(connection, 'Actor::first();')

    // what is written aliases the classes the snippet names without qualifying
    // them, and the index that names them is the project's own — over ssh, the
    // one read on the machine that holds it. Without it the session answers
    // `Class "Actor" not found`
    await new Promise(resolve => setImmediate(resolve))

    expect(exec).toHaveBeenCalledTimes(1)
    expect(wrapRun).toHaveBeenCalledWith('Actor::first();', {Actor: 'App\\Models\\Actor'}, null, null)
  })

  test('reads the project again once the run has answered', async () => {
    createPty(connection, 'the snippet')

    // the run's aliases have been read by the time it is written, and what the
    // run changes in the project is what is read after it: the read this is
    // about is the second one
    await new Promise(resolve => setImmediate(resolve))

    exec.mockClear()

    printed[0]('the value the session printed')

    // the read is the run's own, started where nobody is waiting on it, and what
    // it answers is what the popup is answered out of
    expect(exec).toHaveBeenCalledTimes(1)

    expect(win.webContents.send).toHaveBeenCalledWith('runResult', expect.anything())

    // the read has not answered yet, so the popup has nothing new: it is answered
    // out of what has been read, never out of what is being read
    expect(readyIndex(connection).index.get('actor')).toBeDefined()

    await new Promise(resolve => setImmediate(resolve))

    expect(Array.from(readyIndex(connection).index.get('actor'))).toEqual(['App\\Models\\Actor'])
  })

  test('reads nothing when a session is booted without a run', async () => {
    createPty(connection)

    printed[0]('the output of the session itself')

    expect(exec).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('outputConnection', expect.anything())
  })

  test('writes the run once the session is reading the terminal', async () => {
    let reading = null
    let pty = null

    Pty.mockImplementation(() => {
      pty = {
        connect: jest.fn(),
        type: jest.fn(() => Promise.resolve()),
        ready: jest.fn(() => new Promise(resolve => {
          reading = resolve
        })),
        onData: jest.fn(cb => {
          printed.push(cb)

          return {dispose: jest.fn()}
        }),
        onExit: jest.fn(),
        onCommandExit: jest.fn(),
      }

      return pty
    })

    createPty(connection, 'the snippet')

    // written before the session is reading, anything past the terminal's line
    // limit is dropped and the run arrives cut in half, which the session reads
    // as a syntax error instead of as the run
    expect(pty.type).not.toHaveBeenCalled()

    reading()
    await new Promise(resolve => setImmediate(resolve))

    // typed a line at a time, which is what libedit reads whole
    expect(pty.type).toHaveBeenCalledWith(typedRun('the snippet'))
  })

  test('writes nothing into a session that was replaced while it was booting', async () => {
    let reading = null
    let pty = null

    Pty.mockImplementation(() => {
      pty = {
        connect: jest.fn(),
        type: jest.fn(() => Promise.resolve()),
        ready: jest.fn(() => new Promise(resolve => {
          reading = resolve
        })),
        onData: jest.fn(() => ({dispose: jest.fn()})),
        onExit: jest.fn(),
        onCommandExit: jest.fn(),
      }

      return pty
    })

    createPty(connection, 'the snippet')

    setPtyProcess('remote', null)
    reading()
    await new Promise(resolve => setImmediate(resolve))

    expect(pty.type).not.toHaveBeenCalled()
  })

  // a run that never returns used to leave the pane waiting with no end, and the
  // session holding its connection: the preference is what gives up on it
  test('stops a run that outlives the time it was given', async () => {
    jest.useFakeTimers()

    try {
      let pty = null

      Pty.mockImplementation(() => {
        pty = {
          connect: jest.fn(),
          type: jest.fn(() => Promise.resolve()),
          kill: jest.fn(),
          ready: jest.fn(() => new Promise(() => {})),
          onData: jest.fn(() => ({dispose: jest.fn()})),
          onExit: jest.fn(),
          onCommandExit: jest.fn(),
        }

        return pty
      })

      createPty(connection, 'sleep(60);', null, 5000)

      jest.advanceTimersByTime(4999)
      expect(win.webContents.send).not.toHaveBeenCalledWith('runResult', expect.anything())

      jest.advanceTimersByTime(1)

      const answer = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

      expect(answer[1].timedOut).toBe(true)
      expect(answer[1].error.class).toBe('Timeout')
      expect(answer[1].error.message).toContain('5000ms')
      expect(answer[1].value).toBe(null)
      // nothing was written, so there is no filter to read an output out of: the
      // run printed nothing rather than throwing on the way to its answer
      expect(runOutput).not.toHaveBeenCalled()
      expect(answer[1].output).toBe('')
      // the session is stopped, which is what reaches the php doing the work
      expect(pty.kill).toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  test('reports how long the run took with its answer', async () => {
    createPty(connection, 'the snippet')

    // the session prints the run's value once it has the run (see the write
    // above), which is after the aliases it names have been looked up
    await new Promise(resolve => setImmediate(resolve))

    printed[0]('the value the session printed')

    const answer = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

    expect(typeof answer[1].duration).toBe('number')
    expect(answer[1].duration).toBeGreaterThanOrEqual(0)
  })

  // the bug this waits against: a command that never booted left the pane
  // waiting for an answer that could not come, and the reason — a missing
  // artisan, a platform check — was thrown away
  test('answers a run whose session never booted with what the command said', async () => {
    Pty.mockImplementation(() => ({
      connect: jest.fn(),
      type: jest.fn(() => Promise.resolve()),
      ready: jest.fn(() => Promise.reject(
        Object.assign(new Error('the session\'s command exited before it was ready (exit status 1): Could not open input file: artisan'), {
          name: 'SessionError',
          output: 'Could not open input file: artisan',
        }),
      )),
      onData: jest.fn(() => ({dispose: jest.fn()})),
      onExit: jest.fn(),
      onCommandExit: jest.fn(),
    }))

    createPty(connection, 'the snippet')

    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))

    const answer = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

    expect(answer).toBeDefined()
    expect(answer[1].error.class).toBe('SessionError')
    expect(answer[1].error.message).toContain('Could not open input file: artisan')
    // what the command printed is kept as the run's output, so the pane shows
    // it the way the terminal would have
    expect(answer[1].output).toBe('Could not open input file: artisan')
    expect(answer[1].value).toBe(null)
  })

  // the bug this waits against: a php killed under a run takes the answer with
  // it, and the shell that outlives it prints the status of the line it was
  // given. Without reading that status a run with no limit waited forever, and
  // one with a limit waited out the whole of it
  test('answers a run whose command exits after the session booted', async () => {
    let exited = null

    Pty.mockImplementation(() => ({
      connect: jest.fn(),
      type: jest.fn(() => Promise.resolve()),
      ready: jest.fn(() => Promise.resolve()),
      onData: jest.fn(() => ({dispose: jest.fn()})),
      onExit: jest.fn(),
      onCommandExit: jest.fn(cb => {
        exited = cb

        return {dispose: jest.fn()}
      }),
    }))

    createPty(connection, 'sleep(60);', null, 0)

    // the session is up, so a command exit from here is the run's own end
    await new Promise(resolve => setImmediate(resolve))

    expect(typeof exited).toBe('function')

    exited(new SessionError('the session\'s command exited while the run was going (exit status 137)'))

    const answer = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

    expect(answer[1].value).toBe(null)
    expect(answer[1].error.class).toBe('SessionError')
    expect(answer[1].error.message).toContain('exit status 137')
    // the run is over, exactly once: the shell that outlived the command is
    // still the connection's terminal, sitting at its own prompt
    expect(appendHistory).toHaveBeenCalledTimes(1)
  })

  // the bug this waits against: the failure answer carried an empty output, so
  // what the run had already printed before php died was wiped out of the pane
  // by the error that explained the death
  test('keeps what the run printed when its command exits after boot', async () => {
    const actual = jest.requireActual('tinkr-core')
    const filter = new actual.RunResultFilter('MARKER', 'START')
    let exited = null

    // the run's own filter and the real strip, so what is kept is read out of
    // the stream the session printed rather than handed in
    RunResultFilter.mockImplementationOnce(() => filter)
    runOutput.mockImplementationOnce(actual.runOutput)

    Pty.mockImplementation(() => ({
      connect: jest.fn(),
      type: jest.fn(() => Promise.resolve()),
      ready: jest.fn(() => Promise.resolve()),
      onData: jest.fn(cb => {
        printed.push(cb)

        return {dispose: jest.fn()}
      }),
      onExit: jest.fn(),
      onCommandExit: jest.fn(cb => {
        exited = cb

        return {dispose: jest.fn()}
      }),
    }))

    createPty(connection, 'the snippet', null, 0)

    await new Promise(resolve => setImmediate(resolve))

    // the run started and printed, and then php was killed
    printed[0]('START\r\nhello before the kill\r\n')
    exited(new SessionError('the session\'s command exited while the run was going (exit status 137)'))

    const answer = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

    expect(answer[1].error.class).toBe('SessionError')
    expect(answer[1].output).toBe('hello before the kill')
    expect(appendHistory).toHaveBeenCalledTimes(1)
  })

  // the envelope and the status can arrive in one chunk: the run answered, and
  // then the command ended. The value is the answer, and the exit must not write
  // a second one over it
  test('keeps the answer a run printed when its command exits in the same breath', async () => {
    let exited = null

    Pty.mockImplementation(() => ({
      connect: jest.fn(),
      type: jest.fn(() => Promise.resolve()),
      ready: jest.fn(() => Promise.resolve()),
      onData: jest.fn(cb => {
        printed.push(cb)

        return {dispose: jest.fn()}
      }),
      onExit: jest.fn(),
      onCommandExit: jest.fn(cb => {
        exited = cb

        return {dispose: jest.fn()}
      }),
    }))

    createPty(connection, 'the snippet', null, 0)

    await new Promise(resolve => setImmediate(resolve))

    printed[0]('the value the session printed and the status it printed with it')
    exited(new SessionError('the session\'s command exited while the run was going'))

    const answers = win.webContents.send.mock.calls.filter(([channel]) => channel === 'runResult')

    expect(answers).toHaveLength(1)
    expect(answers[0][1].value).toBe(1)
    expect(appendHistory).toHaveBeenCalledTimes(1)
  })

  test('answers a run when the shell itself exits', async () => {
    let gone = null

    Pty.mockImplementation(() => ({
      connect: jest.fn(),
      type: jest.fn(() => Promise.resolve()),
      ready: jest.fn(() => Promise.resolve()),
      onData: jest.fn(() => ({dispose: jest.fn()})),
      onExit: jest.fn(cb => {
        gone = cb

        return {dispose: jest.fn()}
      }),
      onCommandExit: jest.fn(),
    }))

    createPty(connection, 'the snippet', null, 0)

    await new Promise(resolve => setImmediate(resolve))

    gone()

    const answer = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

    expect(answer[1].error.class).toBe('SessionError')
    expect(answer[1].error.message).toContain('session exited')
    expect(appendHistory).toHaveBeenCalledTimes(1)
    expect(getPtyProcess('remote')).toBe(null)
  })

  // a terminal-only session runs nothing: the command exiting or the shell
  // going away ends the session, and there is no run whose history it would be
  test('writes no history for a session that was booted without a run', () => {
    let exited = null
    let gone = null

    Pty.mockImplementation(() => ({
      connect: jest.fn(),
      onData: jest.fn(() => ({dispose: jest.fn()})),
      onExit: jest.fn(cb => {
        gone = cb

        return {dispose: jest.fn()}
      }),
      onCommandExit: jest.fn(cb => {
        exited = cb

        return {dispose: jest.fn()}
      }),
    }))

    createPty(connection)

    exited(new SessionError('the session\'s command exited while the run was going'))
    gone()

    expect(appendHistory).not.toHaveBeenCalled()
    expect(win.webContents.send).not.toHaveBeenCalledWith('runResult', expect.anything())
  })

  test('ignores a session that was replaced before its command exited', async () => {
    let exited = null

    Pty.mockImplementation(() => ({
      connect: jest.fn(),
      type: jest.fn(() => Promise.resolve()),
      ready: jest.fn(() => Promise.resolve()),
      onData: jest.fn(cb => {
        printed.push(cb)

        return {dispose: jest.fn()}
      }),
      onExit: jest.fn(),
      onCommandExit: jest.fn(cb => {
        exited = cb

        return {dispose: jest.fn()}
      }),
    }))

    createPty(connection, 'the snippet', null, 0)

    await new Promise(resolve => setImmediate(resolve))

    // a newer run took the connection's session
    setPtyProcess('remote', null)

    exited(new SessionError('the session\'s command exited while the run was going'))

    expect(win.webContents.send).not.toHaveBeenCalledWith('runResult', expect.anything())
    expect(appendHistory).not.toHaveBeenCalled()
  })
})

/**
 * A connection on Laravel Cloud: no shell to boot anywhere, and a run that is a
 * command the API is sent.
 *
 * What is checked here is that nothing of a session is started for it — a cloud
 * connection that booted a pty would be a shell on this machine running code
 * that was supposed to run in the environment — and that the answer reaches the
 * window in the shape a session's run answers in.
 */
describe('a run of a connection on Laravel Cloud', () => {
  const cloud = {
    id: 'cloud',
    is_cloud: true,
    path: '',
    cloud_application_id: 'app-1',
    cloud_environment_id: 'env-1',
  }

  beforeEach(() => {
    Pty.mockClear()
    runCloud.mockReset()
    secrets.cloudToken.mockClear()
    appendHistory.mockClear()
  })

  afterEach(() => {
    setEditorWindow('cloud', null)
    setPtyProcess('cloud', null)
  })

  test('is the API\'s, and never a session booted on this machine', async () => {
    const win = {webContents: {send: jest.fn()}}

    setEditorWindow('cloud', win)

    runCloud.mockResolvedValue({
      blocks: [{type: 'text', value: 'hello'}],
      value: "it's",
      error: null,
      queries: [],
      queriesTotal: 0,
      output: 'hello',
      commandId: 'cmd-1',
    })

    createPty(cloud, 'the snippet', null, 45000)

    await new Promise(resolve => setImmediate(resolve))

    // nothing of a session exists for a cloud connection
    expect(Pty).not.toHaveBeenCalled()

    const [connection, code, options] = runCloud.mock.calls[0]

    expect(connection).toBe(cloud)
    expect(code).toBe('the snippet')
    // the run is given the token the app holds and the time it may take, which
    // is the preference's own number of milliseconds
    expect(options.token).toBe('a-cloud-token')
    expect(options.timeout).toBe(45000)
    expect(options.signal.aborted).toBe(false)

    const result = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

    expect(result[1].value).toBe("it's")
    expect(result[1].output).toBe('hello')
    expect(result[1].duration).toBeGreaterThanOrEqual(0)
    expect(win.webContents.send).toHaveBeenCalledWith('runOutput', 'hello')
    expect(win.webContents.send).toHaveBeenCalledWith('historyConnection', [])

    // the run is over, so nothing is left for stop to kill
    expect(getPtyProcess('cloud')).toBe(null)
  })

  // the handle a cloud run leaves behind is what stop, replace and close act on,
  // and a pty's kill is what they call: a handle without one is a stop that
  // threw where the panel's button is
  test('leaves a handle whose kill stops waiting for it', async () => {
    setEditorWindow('cloud', {webContents: {send: jest.fn()}})

    let signal = null

    runCloud.mockImplementation((connection, code, options) => {
      signal = options.signal

      return new Promise(() => {})
    })

    createPty(cloud, 'the snippet')

    // the aliases the run is wrapped with are read before it is sent
    await new Promise(resolve => setImmediate(resolve))

    const handle = getPtyProcess('cloud')

    expect(typeof handle.kill).toBe('function')

    handle.kill()

    expect(signal.aborted).toBe(true)
  })

  // the bug this waits against: a cloud run from a connection naming a local
  // checkout read its aliases from a name that did not exist, so the run threw
  // before it was sent and the pane waited for an answer nobody had asked for
  test('sends a run whose connection names a local checkout', async () => {
    const win = {webContents: {send: jest.fn()}}
    const local = Object.assign({}, cloud, {path: '/a/checkout/that/is/not/here'})

    setEditorWindow('cloud', win)
    runCloud.mockResolvedValue({
      blocks: [],
      value: 7,
      error: null,
      queries: [],
      queriesTotal: 0,
      output: '',
      commandId: 'cmd-7',
    })

    createPty(local, 'the snippet')

    await new Promise(resolve => setImmediate(resolve))

    expect(runCloud).toHaveBeenCalledTimes(1)

    const [, , options] = runCloud.mock.calls[0]

    expect(options.imports).toEqual({})
    expect(win.webContents.send).toHaveBeenCalledWith('runResult', expect.objectContaining({value: 7}))
  })

  // a run that cannot be set up here has still registered a handle, and leaving
  // it there would be a pending run the pane would never hear from
  test('answers a run whose setup failed before it was sent', async () => {
    const win = {webContents: {send: jest.fn()}}

    setEditorWindow('cloud', win)
    secrets.cloudToken.mockImplementationOnce(() => {
      throw new Error('the secrets file could not be read')
    })

    createPty(cloud, 'the snippet')

    await new Promise(resolve => setImmediate(resolve))

    const answer = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

    expect(answer[1].error.class).toBe('Error')
    expect(answer[1].error.message).toContain('the secrets file could not be read')
    expect(runCloud).not.toHaveBeenCalled()
    expect(getPtyProcess('cloud')).toBe(null)
  })

  // a reconnect stops waiting for a pending run, and Laravel Cloud has no way
  // to cancel the command it was already given: the answer says so rather than
  // claiming the command stopped somewhere it cannot
  test('answers an aborted run with what Laravel Cloud keeps doing', async () => {
    const win = {webContents: {send: jest.fn()}}

    setEditorWindow('cloud', win)
    runCloud.mockRejectedValue(Object.assign(
      new Error('The run was stopped.'),
      {name: 'CloudError', code: 'aborted'},
    ))

    createPty(cloud, 'the snippet')

    await new Promise(resolve => setImmediate(resolve))

    const answer = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

    expect(answer[1].error.class).toBe('CloudError')
    expect(answer[1].error.message).toContain('The run was stopped.')
    expect(answer[1].error.message).toContain('may still be running')
    expect(getPtyProcess('cloud')).toBe(null)
  })

  test('answers a refused run with the error\'s own words, in the shape a failed run has', async () => {
    const win = {webContents: {send: jest.fn()}}

    setEditorWindow('cloud', win)

    runCloud.mockRejectedValue(Object.assign(
      new Error('Laravel Cloud keeps running command cmd-1 until it ends.'),
      {name: 'CloudError', code: 'timeout'},
    ))

    createPty(cloud, 'the snippet')

    await new Promise(resolve => setImmediate(resolve))

    const answer = win.webContents.send.mock.calls.find(([channel]) => channel === 'runResult')

    expect(answer[1]).toEqual(expect.objectContaining({
      blocks: [],
      value: null,
      queries: [],
      queriesTotal: 0,
      output: '',
    }))
    expect(answer[1].error).toEqual({
      class: 'CloudError',
      message: 'Laravel Cloud keeps running command cmd-1 until it ends.',
    })
    expect(getPtyProcess('cloud')).toBe(null)
  })

  // a cloud connection is a place runs are sent to, not a shell that a session
  // can be booted in: opening one must not start anything
  test('boots nothing when the window opens it without code', () => {
    setEditorWindow('cloud', {webContents: {send: jest.fn()}})

    createPty(cloud)

    expect(runCloud).not.toHaveBeenCalled()
    expect(Pty).not.toHaveBeenCalled()
  })
})
