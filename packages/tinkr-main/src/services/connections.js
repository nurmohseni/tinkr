const {app} = require('electron')

const {detectPhpVersion} = require('./phpVersion')
const {connections, sessionConnection} = require('../database/connections')
const {
  getPtyProcess,
  setPtyProcess,
  getBackgroundPtyProcess,
  setBackgroundPtyProcess,
  getEditorWindow,
  setEditorWindow,
  getEditorConnection,
  setEditorConnection,
  getCurrentEditorWindow,
  getEditorConnectionId,
  killPtys,
} = require('../processes')
const {quickConnection, appName} = require('../constants')
const {config} = require('../database/config')
const secrets = require('../database/secrets')
const {createEditorWindow} = require('../createEditorWindow')
const {createPty} = require('../createPty')
const {createBackgroundPty} = require('../createBackgroundPty')
const {watchSnippets} = require('./snippetsWatch')

// the connection whose snippets are watched, which is the window's own: one
// window, and one connection it is showing
let snippetsWatcher = null
const {allSnippets} = require('./snippets')

/**
 * Where the app keeps its files, and therefore where a connection's password is.
 *
 * @return {String|null}
 */
const dataDir = () => {
  try {
    return app.getPath('userData')
  } catch (e) {
    return null
  }
}

/**
 * The connections the app lists. The quick connection is the session the
 * folder button boots, not one of the connections themselves, so it is kept
 * out of the list.
 *
 * @returns {Record<string, any>}
 */
const storedConnections = () => {
  const data = Object.assign({}, connections.store)
  delete data[quickConnection.id]

  return data
}

/**
 * @returns {Record<string, any>}
 */
const allConnections = () => storedConnections()

/**
 * The connection the app opens its window on: the first one the store lists,
 * and the quick connection when the store holds nothing else — the store
 * always holds that one, so there is always a connection to open.
 *
 * @returns {Record<string, any>}
 */
const firstConnection = () => {
  return Object.values(storedConnections())[0] ||
    connections.get(quickConnection.id, quickConnection)
}

/**
 * @param {String} id
 */
const deleteConnection = id => {
  // a password whose connection is gone is one nothing can use, and keeping it
  // is keeping a secret for nobody
  secrets.forget(dataDir(), id)
  connections.delete(id)
}

/**
 * @param {String} id
 */
const deleteConnectionConfirm = id => {
  const win = getCurrentEditorWindow()

  if (win) {
    win.webContents.send('deleteConnectionConfirm', getConnection(id))
  }
}

/**
 * @param {String} id
 */
const cloneConnection = id => {
  const win = getCurrentEditorWindow()

  if (win) {
    // a copy is a new connection, and the password of the one it copies is not
    // its own: the flag is dropped, so the copy logs in the way its own fields
    // say it does and the form asks for a password again
    const copy = Object.assign({}, getConnection(id), {ssh_password: false})

    win.webContents.send('cloneConnection', copy)
  }
}

/**
 * Connect to a connection.
 *
 * The app keeps one window, so connecting switches that window to the
 * connection: the sessions of the connection it was running are dropped, the
 * connection's own are booted, and the window is told which connection it is on,
 * so the snippets, the runs and the documents it shows become that connection's.
 *
 * The window is not loaded again for it. What belongs to a connection changes,
 * and what does not — the window, the preferences, the layout, the panel a
 * result is drawn in — is left exactly as it was.
 *
 * @param {Record<string, any>} connection
 * @returns {Promise<void>}
 */
const connectConnection = async connection => {
  connection = sessionConnection(connection)

  const win = getCurrentEditorWindow()

  if (!win) {
    // the window the app opens for a connection asks it for its php itself
    await createEditorWindow(connection)
    return
  }

  const previousId = getEditorConnectionId(win)

  if (previousId) {
    killPtys(previousId)
    setEditorWindow(previousId, null)
    setEditorConnection(previousId, null)
  }

  setEditorWindow(connection.id, win)
  setEditorConnection(connection.id, connection)
  watchSnippetsOf(connection.id)

  createPty(connection)
  createBackgroundPty(connection)

  win.setTitle(`${appName} - ${connection.name}`)

  // the window's own connection, then the terminal it is on: the one it runs
  // reads the new connection from here on, and the session it was watching is
  // the one that was just booted
  win.webContents.send('setConnection', connection.id)
  win.webContents.send('reconnectConnection')

  detectPhpVersion(connection, win)
}

/**
 * Watch the snippets of a connection, so a change made outside the app — by the
 * MCP server an agent is using — reaches the window that is showing them.
 *
 * One watcher at a time: the app keeps one window, and the connection that
 * window is on is the only one whose snippets it shows. A watcher for the
 * connection it left is closed, because nothing is reading what it would send.
 *
 * @param {String} id
 */
const watchSnippetsOf = id => {
  if (snippetsWatcher) {
    snippetsWatcher.close()
    snippetsWatcher = null
  }

  const win = getEditorWindow(id)

  if (!win) {
    return
  }

  snippetsWatcher = watchSnippets(win, id, () => allSnippets(id))
}

const reconnectConnection = connection => {
  connection = sessionConnection(connection)

  const pty = getPtyProcess(connection.id)
  if (pty) {
    pty.kill()
  }
  createPty(connection)
  getEditorWindow(connection.id).webContents.send('reconnectConnection')

  detectPhpVersion(connection, getEditorWindow(connection.id))
}

/**
 * @returns {Record<string, any>}
 */
const createConnection = connection => {
  const stored = secrets.keptConnection(dataDir(), connection)

  connections.set(stored.id, stored)

  return stored
}

/**
 * @param {Record<String, any>} connection
 */
const updateConnection = connection => {
  if (!connections.has(connection.id)) {
    return
  }

  connections.set(connection.id, secrets.keptConnection(dataDir(), connection, connections.get(connection.id, {})))
}

/**
 * @param {String} id
 */
const forgetPassword = id => {
  const connection = connections.get(id, {})

  if (!connection.id) {
    return
  }

  secrets.forget(dataDir(), id)
  connections.set(id, Object.assign({}, connection, {ssh_password: false}))
}

/**
 * @param {String} id
 * @returns {Record<String, any>}
 */
const getConnection = id => connections.get(id, {})

/**
 *
 * @param {String} id
 * @param {String } code
 */
const inputConnection = (id, code) => {
  getPtyProcess(id).input(code)
}

/**
 * How long a run may take, from the preference.
 *
 * The preference is milliseconds and the field that sets it is text, so what is
 * stored is read as a number here: a value that is not a positive number is the
 * default rather than a run that is never given up on.
 *
 * @return {Number}
 */
const runTimeout = () => {
  const stored = Number(config.get('run_timeout'))

  return Number.isFinite(stored) && stored > 0 ? stored : 30000
}

/**
 * Run the code in a session booted from scratch.
 *
 * PHP never reloads a class it has already loaded, so a long lived tinker
 * process keeps running the old code after the files on disk change. Booting a
 * new session for every run is the only way to make sure the code you see in
 * the editor is the code that runs.
 *
 * @param {String} id
 * @param {String} code
 * @param {String} [guard] `rollback` or `commit`, for a run guarded by a
 *   transaction (see runResult.guardArm)
 * @param {Number} [timeout] how long the run may take, in milliseconds, or
 *   nothing for the preference
 */
const runConnection = (id, code, guard = null, timeout = null) => {
  const connection = getEditorConnection(id)

  if (!connection) {
    return
  }

  const pty = getPtyProcess(id)
  if (pty) {
    pty.kill()
    setPtyProcess(id, null)
  }

  const backgroundPty = getBackgroundPtyProcess(id)
  if (backgroundPty) {
    backgroundPty.kill()
    setBackgroundPtyProcess(id, null)
  }

  const win = getEditorWindow(id)
  if (win) {
    // the terminal shows a brand new session now
    win.webContents.send('reconnectConnection')
  }

  createPty(connection, code, guard, timeout === null ? runTimeout() : timeout)
}

/**
 * Stop what a connection is running.
 *
 * A run is a session of its own, and a session's kill is what reaches the php
 * inside it (see tinkr-core's Session#kill): the interrupt goes in, then the
 * quit, then the signal. So stopping a run is ending the session it is in, and
 * the next run boots its own — which is what a run does anyway.
 *
 * @param {String} id
 */
const stopConnection = id => {
  const pty = getPtyProcess(id)

  if (pty) {
    pty.kill()
    setPtyProcess(id, null)
  }
}

/**
 * @param {String} id
 */
const closeConnection = async id => {
  // the window is what the watcher pushes to, and it is going
  if (snippetsWatcher) {
    snippetsWatcher.close()
    snippetsWatcher = null
  }

  const win = getEditorWindow(id)

  if (win) {
    win.close()
  }
}

module.exports = {
  allConnections,
  firstConnection,
  deleteConnection,
  deleteConnectionConfirm,
  cloneConnection,
  createConnection,
  updateConnection,
  forgetPassword,
  getConnection,
  inputConnection,
  runConnection,
  runTimeout,
  stopConnection,
  closeConnection,
  connectConnection,
  reconnectConnection,
}
