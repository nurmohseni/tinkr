const {wrapRun, RunResultFilter, importsFor, runOutput} = require('tinkr-core')

const {Pty} = require('./pty/Pty')

const {getEditorWindow, getPtyProcess, setPtyProcess} = require('./processes')
const {appendHistory} = require('./services/history')
const {refreshIndex} = require('./services/project')

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
 * session can alias them before it evaluates it (see classIndex.importsFor).
 * That is a lookup in an index the connection pays for once.
 *
 * A guarded run is wrapped with the transaction it is evaluated inside, so the
 * run's envelope carries how that transaction ended (see runResult.guardArm).
 *
 * @param {Record<String, any>} connection
 * @param {String} [code]
 * @param {String} [guard] `rollback` or `commit`
 */
const createPty = (connection, code, guard = null) => {
  const {id} = connection

  const pty = new Pty(connection)
  // a session over ssh runs in the remote project, whose composer files are not
  // on this machine to read
  const imports = code && !connection.is_over_ssh && connection.path
    ? importsFor(connection.path, code)
    : {}
  const run = code ? wrapRun(code, imports, guard) : null
  const filter = run ? new RunResultFilter(run.marker, run.start) : null

  pty.connect()

  const onData = pty.onData(data => {
    // a session that has been replaced may still print while it goes away
    if (getPtyProcess(id) !== pty) {
      return
    }

    const win = getEditorWindow(id)

    if (!win) {
      return
    }

    if (!filter) {
      win.webContents.send('outputConnection', data)
      return
    }

    const {output, run, result} = filter.push(data)

    if (output) {
      win.webContents.send('outputConnection', output)
    }

    // the output pane shows what the run printed, never the session booting: it
    // listens on a channel of its own, and the terminal tab keeps the whole
    // session
    if (run) {
      win.webContents.send('runOutput', run)
    }

    if (result) {
      // the output pane shows what the run printed as well as what it
      // returned, so the envelope carries both
      win.webContents.send('runResult', Object.assign({}, result, {
        output: runOutput(filter),
      }))

      // the run is over, and it is what the connection's history remembers:
      // the list comes back pruned, and it is what the sidebar draws
      win.webContents.send('historyConnection', appendHistory(id, code, result))

      // the project on disk may be what the run changed — a file it wrote, an
      // autoloader it dumped — and the popup is answered out of what has been
      // read of it, so the read is set going now, after the run and while nobody
      // is waiting on it (see services/project)
      refreshIndex(connection)
    }
  })

  pty.onExit(() => {
    if (onData) {
      onData.dispose()
    }
  })

  setPtyProcess(id, pty)

  if (run) {
    pty.ready().then(() => {
      // the session may have been replaced, or closed, while it was booting
      if (getPtyProcess(id) !== pty) {
        return
      }

      pty.input(`${run.code}\r`)
    })
  }
}

module.exports = {
  createPty,
}
