const {connections} = require('../database/connections')
const {getCurrentEditorWindow, getEditorConnectionId} = require('../processes')
const {connectConnection} = require('./connections')
const {createEditorWindow} = require('../createEditorWindow')

/**
 * Bring the editor window forward, restoring it first when it was minimized.
 *
 * @param {Electron.BrowserWindow} win
 */
const raise = win => {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
    return
  }

  if (typeof win.isMinimized === 'function' && win.isMinimized()) {
    win.restore()
  }

  win.show()
  win.focus()
}

/**
 * Open one tool call's code in the editor window, as a new tab.
 *
 * The window is put on the call's connection the way the app's own connection
 * switcher puts it there: the same service that a click on a connection row
 * calls. A window that is already on that connection is left exactly as it is,
 * which is what the switcher does with the row of the connection on screen, so
 * a run going in it is untouched. A window that does not exist is opened the
 * way the app opens one for a connection.
 *
 * The code is not run. The message that follows the switch is what starts the
 * tab (see the editor window's own listener), after the window has been told
 * which connection it is on, so the tab belongs to the call's connection and
 * not to the one that was on screen.
 *
 * @param {{connectionId?: String, name?: String, code?: String}} request
 * @return {Promise<{opened: Boolean, reason?: String}>} `reason` is
 *   `no-code` for a call with nothing to open, `no-connection` for one whose
 *   connection the app does not have — a directory target, or a connection
 *   that has been deleted
 */
const openCall = async ({connectionId, name, code} = {}) => {
  if (typeof code !== 'string' || code.trim() === '') {
    return {opened: false, reason: 'no-code'}
  }

  const connection = typeof connectionId === 'string' && connectionId
    ? connections.get(connectionId, null)
    : null

  if (!connection || !connection.id) {
    return {opened: false, reason: 'no-connection'}
  }

  let win = getCurrentEditorWindow()

  if (!win) {
    win = await createEditorWindow(connection)
  } else if (getEditorConnectionId(win) !== connection.id) {
    await connectConnection(connection)
  }

  win.webContents.send('openMcpCall', {name: String(name || ''), code})

  raise(win)

  return {opened: true}
}

module.exports = {
  openCall,
}
