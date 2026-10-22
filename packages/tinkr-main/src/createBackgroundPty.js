const {isCloud} = require('tinkr-core')

const {BackgroundPty} = require('./pty/BackgroundPty')

const {prefetchIndex} = require('./services/project')
const {ensureMaster} = require('./remote')

const {
  setBackgroundPtyProcess,
  getBackgroundPtyProcess,
  getEditorConnection,
} = require('./processes')

const createBackgroundPty = connection => {
  const {id} = connection

  // a connection on Laravel Cloud has no session anything could be asked of,
  // and no background one either: a second command is a second command in the
  // environment's history, on production, for a popup
  if (isCloud(connection)) {
    return
  }

  // a connection over ssh is opened before it is used rather than by the first
  // thing that uses it: the login is what a run of a snippet would otherwise wait
  // for, and it is made here while the window is still coming up (see
  // remote.ensureMaster). Nothing waits on it — an ssh that does not answer is a
  // connection that is slow rather than one that does not work
  ensureMaster(connection)

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
 * A connection on Laravel Cloud never has one: there is no session to ask, and
 * what a cloud connection offers instead is read from the local checkout it
 * names, if it names one.
 *
 * @param {String} id
 */
const ensureBackgroundPty = id => {
  if (getBackgroundPtyProcess(id)) {
    return
  }

  const connection = getEditorConnection(id)

  if (!connection || isCloud(connection)) {
    return
  }

  createBackgroundPty(connection)
}

module.exports = {
  createBackgroundPty,
  ensureBackgroundPty,
}
