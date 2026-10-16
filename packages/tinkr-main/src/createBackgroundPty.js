const {BackgroundPty} = require('./pty/BackgroundPty')

const {prefetchIndex} = require('./services/project')

const {
  setBackgroundPtyProcess,
  getBackgroundPtyProcess,
  getEditorConnection,
} = require('./processes')

const createBackgroundPty = connection => {
  const {id} = connection

  const pty = new BackgroundPty(connection)
  pty.connect()

  setBackgroundPtyProcess(id, pty)

  // the project of the connection is read here, where a session comes up, and
  // read with a command of its own rather than through the session (see
  // services/project): the suggestion popup asks on every keystroke, and a
  // keystroke is no moment to walk another machine. A project that has been read
  // is not read again here — the run that changed it refreshes it (see createPty)
  // — so a session booted beside a read answer costs nobody a walk.
  prefetchIndex(connection)
}

/**
 * The background pty dies with the session, so the snippet form boots it again
 * the first time it needs to resolve a value. Booting it lazily keeps a run
 * from paying for a session it may never use.
 *
 * @param {String} id
 */
const ensureBackgroundPty = id => {
  if (getBackgroundPtyProcess(id)) {
    return
  }

  const connection = getEditorConnection(id)
  if (connection) {
    createBackgroundPty(connection)
  }
}

module.exports = {
  createBackgroundPty,
  ensureBackgroundPty,
}
