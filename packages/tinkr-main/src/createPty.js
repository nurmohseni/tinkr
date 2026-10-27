const {
  wrapRun,
  typedRun,
  RunResultFilter,
  runOutput,
  isCloud,
  runCloud,
  SessionError,
} = require('tinkr-core')

const {Pty} = require('./pty/Pty')

const {
  getEditorWindow,
  getPtyProcess,
  setPtyProcess,
  setBufferedAnswer,
} = require('./processes')
const {appendHistory} = require('./services/history')
const {importsForRun, refreshIndex} = require('./services/project')
const secrets = require('./database/secrets')
const {dataDir} = require('./utils/dataDir')

/**
 * Boot a session for the connection, and optionally run `code` in it.
 *
 * The code is written once the session is reading the terminal, which is what
 * the session's own ready() settles on (see Session#ready). The pty takes only
 * so much input before the command that reads it is up: past 4096 bytes, the
 * terminal's line limit, the rest is dropped, and a run that goes in earlier
 * arrives cut in half and is parsed as a syntax error instead of as the run.
 *
 * The code is wrapped (see runResult.wrapRun) so the session prints its value
 * as json between two markers. That envelope never reaches the terminal: it is
 * turned into the run's result instead.
 *
 * A run also names the classes the snippet uses without qualifying them, so the
 * session can alias them before it evaluates it (see classIndex.importsIn). That
 * is a lookup in an index the connection pays for once, and it is the index of
 * the project the session runs in — which, over ssh, is read from the machine
 * that project is on (see services/project). What is written into the session is
 * therefore built after that lookup answers, and the session boots while it is
 * being answered.
 *
 * A guarded run is wrapped with the transaction it is evaluated inside, so the
 * run's envelope carries how that transaction ended (see runResult.guardArm).
 *
 * A run is also given the time it may take (see the `run_timeout` preference).
 * The session is one process among others, and a snippet that never returns —
 * a `sleep`, a loop, a query on a locked table — used to leave the pane waiting
 * with no end and the terminal's line discipline holding the session. When the
 * time is up the session is stopped, which is what reaches the php doing the
 * work, and the pane is answered with the wait it was.
 *
 * A connection on Laravel Cloud has no session at all: nothing here is booted
 * for it, and its run is a command sent to Laravel Cloud (see runInCloud).
 *
 * @param {Record<String, any>} connection
 * @param {String} [code]
 * @param {String} [guard] `rollback` or `commit`
 * @param {Number} [timeout] how long the run may take, in milliseconds
 */
const createPty = (connection, code, guard = null, timeout = null) => {
  if (isCloud(connection)) {
    runInCloud(connection, code, guard, timeout)

    return
  }

  const {id} = connection

  const pty = new Pty(connection)

  // the classes the snippet names without qualifying them, for the session to
  // alias before it evaluates it (see classIndex.importsIn). It is asked for
  // here, before the session boots, so the two waits overlap: a project over ssh
  // is read on the machine that holds it, and that read is usually the one the
  // connection was opened with (see prefetchIndex)
  const imports = code ? importsForRun(connection, code) : Promise.resolve({})

  const startedAt = Date.now()
  let run = null
  let filter = null
  let timer = null
  let settled = false
  let booted = false

  // whether a run is going in this session, which is what decides whether the
  // session outlives a move to another connection: a session sitting at its
  // prompt is the app's to end, one that is running something is the person's
  pty.running = Boolean(code)

  /**
   * The run's answer, out of the envelope: the pane is told what it returned,
   * what it printed, and how long the whole of it took — the boot of the session
   * included, because that is the wait the person sat through.
   *
   * Once only: a run has one answer, and a session that was replaced, stopped or
   * timed out must not write a second one over the run that took its place.
   *
   * @param {Object} result
   */
  const answered = result => {
    if (settled) {
      return
    }

    settled = true
    clearTimeout(timer)

    // what the run printed is the filter's; a run that never reached the
    // session brings its own output, because there was no run to print
    // anything, and so does one that was stopped before it was written
    const answer = Object.assign({}, result, {
      output: result.output === undefined ? (filter ? runOutput(filter) : '') : result.output,
      duration: Date.now() - startedAt,
    })
    // the run is over, and the history row is the connection's whether or not
    // the window is on it: a run that came back while the person was elsewhere
    // is still a run that happened
    const history = appendHistory(id, code, answer)

    pty.running = false

    refreshIndex(connection)

    const win = getEditorWindow(id)

    if (win) {
      win.webContents.send('runResult', answer)
      win.webContents.send('historyConnection', history)

      return
    }

    // the window is showing another connection: the answer waits for this one,
    // and the session that has answered is ended here rather than left running
    // for nobody. What it printed is part of the answer, so the pane reads it
    // when the answer lands
    setBufferedAnswer(id, {answer, history})

    if (getPtyProcess(id) === pty) {
      setPtyProcess(id, null)
      pty.kill()
    }
  }

  /**
   * A run whose command ended — php was killed or it died — or whose shell went
   * away, as the answer a failed run has.
   *
   * What the command said is the message, so the pane shows the reason rather
   * than a wait that ended for no stated reason. `output` is given for a failure
   * that has its own words — a command that never booted — and left out for one
   * that ended under a run: there the run printed whatever it printed before it
   * died, and the answer keeps that stream rather than emptying the pane
   * (see `answered`).
   *
   * @param {Error} error
   * @param {String} [output]
   */
  const failed = (error, output) => {
    const answer = {
      blocks: [],
      value: null,
      error: {
        class: error && error.name === 'SessionError' ? 'SessionError' : 'Error',
        message: error && error.message ? error.message : String(error),
      },
      queries: [],
      queriesTotal: 0,
    }

    if (output !== undefined) {
      answer.output = output
    }

    answered(answer)
  }

  /**
   * Stop a run that took longer than it was given, and say so.
   *
   * The result is the shape every failed run has, so the pane and the history
   * read it the same way: no value, an error, and the wait it reached.
   */
  const timedOut = () => {
    if (getPtyProcess(id) !== pty) {
      return
    }

    setPtyProcess(id, null)
    pty.kill()

    answered({
      blocks: [],
      value: null,
      error: {
        class: 'Timeout',
        message: `the run was stopped after ${timeout}ms`,
      },
      queries: [],
      queriesTotal: 0,
      timedOut: true,
    })
  }

  pty.connect()

  if (code && timeout > 0) {
    timer = setTimeout(timedOut, timeout)
  }

  const onData = pty.onData(data => {
    // a session that has been replaced may still print while it goes away
    if (getPtyProcess(id) !== pty) {
      return
    }

    const win = getEditorWindow(id)

    if (!filter) {
      if (win) {
        win.webContents.send('outputConnection', data)
      }

      return
    }

    // the filter is fed whether or not the window is on this connection: a run
    // goes on while the person is elsewhere, and what it answers is read out of
    // the stream the same way either way
    const {output, run, result} = filter.push(data)

    if (win) {
      if (output) {
        win.webContents.send('outputConnection', output)
      }

      // the output pane shows what the run printed, never the session booting: it
      // listens on a channel of its own, and the terminal tab keeps the whole
      // session
      if (run) {
        win.webContents.send('runOutput', run)
      }
    }

    // the run is over: what came back, what it printed, and how long it took.
    // The project on disk may be what it changed, so it is read again now, while
    // nobody is waiting on it (see services/project)
    if (result) {
      answered(result)
    }
  })

  // the command the shell was given has exited: php was killed or it died, and
  // the run will never answer. The status the shell printed is the answer,
  // instead of a timeout. The session may have been replaced by a newer run or
  // stopped already, and a run that answered from the same chunk (see
  // Session#noteCommandExit) is the answer, so only the run still going here is
  // answered. A session booting is not: ready() answers it with what the
  // command said. A terminal-only session runs nothing and has nothing to write
  // into its history
  pty.onCommandExit(error => {
    // the command is gone: its timer has nothing left to time out
    clearTimeout(timer)

    if (!booted || settled || !pty.running || getPtyProcess(id) !== pty) {
      return
    }

    // the shell outlived the command and is at its own prompt, so the session
    // stays as the terminal it is; what ended is the run. It is answered once,
    // and a later run replaces the session the way any run does
    failed(error)
  })

  pty.onExit(() => {
    clearTimeout(timer)

    if (onData) {
      onData.dispose()
    }

    if (getPtyProcess(id) !== pty) {
      return
    }

    setPtyProcess(id, null)

    // a shell that went away under a run ends it just as promptly as a command
    // that exited: nothing is coming from a session that is gone
    if (settled || !pty.running) {
      return
    }

    failed(new SessionError('the session exited while the run was going'))
  })

  setPtyProcess(id, pty)

  if (code) {
    pty.ready()
      // the command took the terminal, so a command exit from here on is the
      // run's own end rather than a boot that failed
      .then(() => {
        booted = true

        // the run is built once its aliases are known, because they are part of
        // what is written: the wrapping is the same either way, and what it
        // aliases is what the lookup answered
        return imports
      })
      .then(aliases => {
        // the session may have been replaced, closed, or stopped for taking too
        // long while it was booting or while its aliases were being read
        if (getPtyProcess(id) !== pty) {
          return
        }

        run = wrapRun(code, aliases, guard, timeout)
        filter = new RunResultFilter(run.marker, run.start)

        // typed a line at a time: one line of the whole run is more than
        // libedit reads (see runResult.typedRun)
        return pty.type(typedRun(run.code))
      }).catch(error => {
        // the command never became the session — a missing `artisan`, a platform
        // check, a php that is not there — so the run did not happen and the
        // reason is the command's own words. Without this the wait was the pane's
        // whole answer, and it never came
        if (getPtyProcess(id) !== pty) {
          return
        }

        // a command that never booted speaks for itself; one that failed after
        // the run started keeps what the run printed (see `failed`)
        if (booted) {
          failed(error)
        } else {
          failed(error, error.output || '')
        }
      })
  }
}

/**
 * Run a snippet inside a Laravel Cloud environment.
 *
 * A cloud connection has no session to boot and nothing on this machine to
 * start: the run is one command sent to Laravel Cloud, which runs it in the
 * environment's own container and answers when it ends (see tinkr-core's
 * runCloud). What a session's run answers through — the window, the history,
 * the project index — is answered the same way here, so nothing that reads a
 * result has to know which kind of connection it came from.
 *
 * The handle kept for the connection is what stop, replace and close act on. A
 * pty's kill reaches the php doing the work; a cloud run has no process of ours
 * to reach, so the handle's kill ends this wait only, and the answer says so —
 * Laravel Cloud has no way to cancel a command it was given.
 *
 * A cloud connection has no terminal, so a call without code boots nothing: the
 * connection is a place runs are sent to, and the status line the window shows
 * is written where the connection is opened (see services/connections).
 *
 * @param {Record<String, any>} connection
 * @param {String} [code]
 * @param {String} [guard]
 * @param {Number} [timeout]
 */
const runInCloud = (connection, code, guard, timeout) => {
  if (!code) {
    return
  }

  const {id} = connection
  const startedAt = Date.now()
  const stop = new AbortController()
  const handle = {kill: () => stop.abort()}

  // a cloud command goes on in Laravel Cloud whether or not this window shows
  // the connection, so the handle is one the move to another connection keeps
  // (see services/connections)
  handle.running = true

  setPtyProcess(id, handle)

  /**
   * The run's answer, as the pane, the history and the index read it.
   *
   * A run that was replaced or that went away with its window answers nobody:
   * the handle is what says whether anyone is still waiting for this one.
   *
   * @param {Object} answer
   */
  const settled = answer => {
    if (getPtyProcess(id) !== handle) {
      return
    }

    setPtyProcess(id, null)

    handle.running = false

    const result = Object.assign({}, answer, {
      output: answer.output === undefined ? '' : answer.output,
      duration: Date.now() - startedAt,
    })
    const history = appendHistory(id, code, result)

    refreshIndex(connection)

    const win = getEditorWindow(id)

    if (!win) {
      // the command ended while the window was on another connection: it is the
      // connection's to read when it is shown again
      setBufferedAnswer(id, {answer: result, history})

      return
    }

    // the output pane is the run's own output, on the channel a session's run
    // prints to, so the two kinds of run read the same in the pane
    if (result.output) {
      win.webContents.send('runOutput', result.output)
    }

    win.webContents.send('runResult', result)
    win.webContents.send('historyConnection', history)
  }

  /**
   * The run's answer when it did not come back: a timeout, a stop, a command
   * Laravel Cloud refused, or a command that could not be set up here.
   *
   * Each says its own reason in its message, and the shape is the one every
   * failed run has, so the pane and the history read it the same way. What a
   * failed command printed is already the message's own words (see tinkr-core's
   * runCloud), so the run's output is nothing of its own here.
   *
   * A run that was stopped — by Stop, or by a reconnect that ends this wait —
   * is aborted here while Laravel Cloud keeps going: the message says so rather
   * than leaving the pane with a run that only "stopped" somewhere it cannot.
   *
   * @param {Error} error
   */
  const failed = error => {
    const message = error && error.message ? error.message : String(error)
    const aborted = error && error.code === 'aborted'
    const honest = aborted && !/keeps running/i.test(message)
      ? `${message} Laravel Cloud may still be running what it started.`
      : message

    settled({
      blocks: [],
      value: null,
      error: {
        // the error's own name is what it says it is: a CloudError names itself,
        // and reading the name rather than the constructor keeps that true even
        // when the core module is loaded twice
        class: (error && error.name) || 'Error',
        message: honest,
      },
      queries: [],
      queriesTotal: 0,
      output: '',
    })
  }

  let options = null

  try {
    options = {
      token: secrets.cloudToken(dataDir()),
      guard,
      signal: stop.signal,
    }

    // nothing given is Laravel Cloud's own default rather than a run with no end
    if (timeout > 0) {
      options.timeout = timeout
    }
  } catch (error) {
    // a token that cannot be read is a run that cannot be sent: the handle it
    // registered is answered through the same finalizer as every other failure
    // rather than left as the connection's pending run
    failed(error)

    return
  }

  // a cloud connection's project is inside Laravel Cloud, where this machine
  // cannot read composer's files: the classes a snippet names are read from the
  // local checkout the connection names, if it names one, which is the only copy
  // of the project this side has (see services/project importsForRun)
  const aliases = connection.path ? importsForRun(connection, code) : Promise.resolve({})

  Promise.resolve(aliases)
    .then(imports => {
      // a run that was replaced while its aliases were being read is not sent:
      // its handle is not the connection's any more, and its answer belongs to
      // nobody
      if (getPtyProcess(id) !== handle) {
        return
      }

      options.imports = imports

      return runCloud(connection, code, options)
    })
    .then(result => settled(result), failed)
}

module.exports = {
  createPty,
}
