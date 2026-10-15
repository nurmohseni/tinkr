const {Pty} = require('./pty/Pty')

const {getEditorWindow, getPtyProcess, setPtyProcess} = require('./processes')
const {wrapRun, RunResultFilter} = require('./runResult')
const {stripSessionNotes} = require('./terminalOutput')
const {appendHistory} = require('./services/history')
const {importsFor} = require('./classIndex')

/**
 * Boot a session for the connection, and optionally run `code` in it.
 *
 * The code is written right after the connection command, before the session
 * has finished booting. That is safe: the pty queues the input and the shell
 * (then tinker) reads it in order, exactly like a paste into a fresh terminal.
 *
 * The code is wrapped (see runResult.wrapRun) so the session prints its value
 * as json between two markers. That envelope never reaches the terminal: it is
 * turned into the run's result instead.
 *
 * A run also names the classes the snippet uses without qualifying them, so the
 * session can alias them before it evaluates it (see classIndex.importsFor).
 * That is a lookup in an index the connection pays for once.
 *
 * @param {Record<string, any>} connection
 * @param {String} [code]
 */
const createPty = (connection, code) => {
  const {id} = connection

  const pty = new Pty(connection)
  // a session over ssh runs in the remote project, whose composer files are not
  // on this machine to read
  const imports = code && !connection.is_over_ssh && connection.path
    ? importsFor(connection.path, code)
    : {}
  const run = code ? wrapRun(code, imports) : null
  const filter = run ? new RunResultFilter(run.marker, run.start) : null

  pty.connect()

  if (run) {
    pty.input(`${run.code}\r`)
  }

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
        output: stripSessionNotes(filter.printed).replace(/\r\n/g, '\n').trim(),
      }))

      // the run is over, and it is what the connection's history remembers:
      // the list comes back pruned, and it is what the sidebar draws
      win.webContents.send('historyConnection', appendHistory(id, code, result))
    }
  })

  pty.onExit(() => {
    if (onData) {
      onData.dispose()
    }
  })

  setPtyProcess(id, pty)
}

module.exports = {
  createPty,
}
