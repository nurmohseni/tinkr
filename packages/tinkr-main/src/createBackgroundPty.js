const {BackgroundPty} = require('./pty/BackgroundPty')

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
