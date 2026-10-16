const {detectPhpVersion} = require('./phpVersion')
const {connections} = require('../database/connections')
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
const {createEditorWindow} = require('../createEditorWindow')
const {createPty} = require('../createPty')
const {createBackgroundPty} = require('../createBackgroundPty')

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
    win.webContents.send('cloneConnection', getConnection(id))
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

const reconnectConnection = connection => {
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
  connections.set(connection.id, connection)
}

/**
 * @param {Record<string, any>} connection
 */
const updateConnection = connection => {
  if (connections.has(connection.id)) {
    connections.set(connection.id, connection)
  }
}

/**
 * @param {String} id
 * @returns {Record<string, any>}
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
 */
const runConnection = (id, code, guard = null) => {
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

  createPty(connection, code, guard)
}

/**
 * @param {String} id
 */
const closeConnection = async id => {
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
  getConnection,
  inputConnection,
  runConnection,
  closeConnection,
  connectConnection,
  reconnectConnection,
}
