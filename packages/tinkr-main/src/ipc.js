const {app, BrowserWindow, ipcMain, shell} = require('electron')
const log = require('electron-log')

const {cloudApplications, isCloud, CloudError} = require('tinkr-core')

const secrets = require('./database/secrets')
const {dataDir} = require('./utils/dataDir')
const {selectDirectory, selectFile} = require('./utils/selectFileOrDirectory')
const {saveFile} = require('./utils/saveFile')
const {allLocales} = require('./utils/allLocales')
const {quickConnection} = require('./constants')
const {getIntlConfig} = require('./locale')
const {createPreferenceWindow} = require('./createPreferenceWindow')
const {connectionContextMenu} = require('./connectionContextMenu')
const {
  deleteConnection,
  createConnection,
  updateConnection,
  forgetPassword,
  allConnections,
  getConnection,
  inputConnection,
  runConnection,
  stopConnection,
  closeConnection,
  connectConnection,
  reconnectConnection,
} = require('./services/connections')
const {setLocale, getLocale, allConfig, setConfig} = require('./services/config')
const {containers, projectDirs} = require('./services/discovery')
const {createSnippet, allSnippets, updateSnippet, deleteSnippet} = require('./services/snippets')
const {allHistory, clearHistory} = require('./services/history')
const {parsePhpForm, stringifyPhpForm} = require('./services/php')
const {drawsControls} = require('./utils/frame')
const {phpCompletions} = require('./completion')
const {complete, ask, check} = require('./services/ai')
const {providers} = require('./aiProviders')
const {checkForUpdates, downloadUpdate, installUpdate} = require('./updater')
const {info: mcpInfo, configureClient} = require('./services/mcp')
const {filesFor, attachmentsFor} = require('./services/project')
const {files: logFiles, read: readLog} = require('./services/logs')
const {getEditorConnection, getEditorConnectionId} = require('./processes')
const {createLogsWindow} = require('./createLogsWindow')

ipcMain.on('selectDirectory', (event, defaultPath) => {
  event.returnValue = selectDirectory(defaultPath)
})

ipcMain.on('selectFile', (event, defaultPath) => {
  event.returnValue = selectFile(defaultPath)
})

ipcMain.on('saveFile', (event, defaultPath, contents) => {
  event.returnValue = saveFile(defaultPath, contents)
})

ipcMain.on('setLocale', (event, lang) => {
  setLocale(lang)
})

ipcMain.on('getLocale', event => {
  event.returnValue = getLocale()
})

ipcMain.on('allConfig', event => {
  event.returnValue = allConfig()
})

ipcMain.on('setConfig', (event, config) => {
  setConfig(config)
})

ipcMain.on('allLocales', event => {
  event.returnValue = allLocales
})

ipcMain.on('aiProviders', event => {
  event.returnValue = providers
})

ipcMain.on('getIntlConfig', event => {
  event.reply('setIntlConfig', getIntlConfig())
})

ipcMain.on('createConnection', (event, connection) => {
  createConnection(connection)
})

ipcMain.on('getConnection', (event, id) => {
  event.returnValue = getConnection(id)
})

ipcMain.on('deleteConnection', (event, id) => {
  deleteConnection(id)
})

ipcMain.on('allConnections', event => {
  event.returnValue = allConnections()
})

ipcMain.on('updateConnection', (event, connection) => {
  updateConnection(connection)
})

/**
 * Forget the password a connection logs in with.
 *
 * The window never holds the password, so it cannot remove one by clearing a
 * field the way it would clear a name: this call is the removal. What the window
 * keeps is the flag, and the renderer clears that itself — a rerun of the
 * connection is what makes the next session log in without it.
 */
ipcMain.on('forgetPassword', (event, id) => {
  forgetPassword(id)
})

/**
 * What an engine is running on the machine this connection reaches.
 *
 * The form offers these instead of asking for a name: a container created by a
 * compose file or a PaaS is named per deploy, so a typed name is stale after the
 * next one. A machine that cannot answer is a form with nothing to offer, not a
 * failure — what was typed by hand is still what the connection uses.
 */
ipcMain.handle('listContainers', async (event, connection) => containers(connection))

/**
 * The directories inside a container that look like a php project.
 *
 * A deployed project is somewhere under the container's own files, and its path
 * is the one thing a form cannot know: this is what it can be picked from.
 */
ipcMain.handle('listProjectDirs', async (event, connection) => projectDirs(connection))

ipcMain.on('connectConnection', async (event, connection) => {
  // the password the form was holding is written here, and what the session
  // boots from is the stored connection rather than the form: connectConnection
  // reads it back, so the first session of a new connection logs in with the
  // password it was given
  updateConnection(connection)

  await connectConnection(connection)
})

ipcMain.on('reconnectConnection', async (event, connection) => {
  reconnectConnection(connection)
})

ipcMain.on('inputConnection', (event, id, code) => {
  inputConnection(id, code)
})

ipcMain.on('stopConnection', (event, id) => {
  stopConnection(id)
})

ipcMain.on('runConnection', (event, id, code, guard) => {
  runConnection(id, code, guard)
})

ipcMain.on('closeConnection', async (event, id) => {
  await closeConnection(id)
})

/**
 * The window controls of a frameless window.
 *
 * The frame is the app's own on Windows and Linux (see utils/frame), so
 * minimize, maximize and close are asked for from the page: the window a
 * message came from is the one it acts on, which is what makes the same
 * controls work in the editor and the settings window without either saying
 * which it is.
 */
const windowOf = event => BrowserWindow.fromWebContents(event.sender)

ipcMain.on('windowControl', (event, control) => {
  const win = windowOf(event)

  if (!win) {
    return
  }

  if (control === 'minimize') {
    win.minimize()
  } else if (control === 'maximize') {
    // a window that is maximized restores, which is what the one button does
    win.isMaximized() ? win.unmaximize() : win.maximize()
  } else if (control === 'close') {
    win.close()
  }
})

// the titlebar draws the maximize button differently while the window is
// maximized, so it is told when that changes and what the state already is when
// it asks
const tellWindowState = win => {
  if (win && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send('windowState', {maximized: win.isMaximized()})
  }
}

ipcMain.handle('windowState', event => ({
  maximized: Boolean(windowOf(event) && windowOf(event).isMaximized()),
  controls: drawsControls(),
}))

// every window of the app gets the listener, once each
app.on('browser-window-created', (event, win) => {
  for (const name of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(name, () => tellWindowState(win))
  }
})

ipcMain.on('quickConnect', async event => {
  const path = selectDirectory()
  if (path) {
    // the quick connection is a session, not a stored connection: the window
    // switches to it, booted on the picked directory
    await connectConnection({
      ...quickConnection,
      path,
    })
  }
})

/**
 * Open the preferences, optionally on one of its sections.
 *
 * The section travels as a message rather than as part of the window's url: the
 * window is the app's one settings window, so asking for a section while it is
 * open is switching the section of the window that is there, and a section is
 * what a pressed link in the editor — "add a Laravel Cloud token" — is asking
 * for (see createPreferenceWindow).
 */
ipcMain.on('openPreference', (event, section) => {
  createPreferenceWindow(typeof section === 'string' ? section : undefined)
})

/**
 * Open a link in the person's own browser.
 *
 * The app draws its own windows, and a link that navigated one of them would
 * replace the editor with a web page: what a link in a settings section is for
 * is the page it names, in the browser that already has the person's session.
 * Nothing but http(s) is opened, because a `file:` or a scheme an installed
 * program handles is not a link a window may hand to the system on its own.
 */
ipcMain.on('openExternal', (event, url) => {
  let parsed = null

  try {
    parsed = new URL(String(url || ''))
  } catch (e) {
    parsed = null
  }

  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    log.error('[window] a link was not opened, because it is not a web address:', String(url))

    return
  }

  shell.openExternal(parsed.toString())
})

/**
 * The error code a Laravel Cloud failure is reported with.
 *
 * A CloudError carries its own code, which is what the settings screen words its
 * answer by; anything else — a bug, a fetch that threw something of its own — is
 * a failure without a better name.
 *
 * @param {Error} error
 * @return {String}
 */
const cloudCodeOf = error => (error instanceof CloudError ? error.code : 'failed')

/**
 * Whether a Laravel Cloud API token is saved.
 *
 * The window is told that there is one and never what it is: the token is the
 * main process's to hold, and every call that needs it is made here.
 */
ipcMain.handle('cloudStatus', async () => ({hasToken: secrets.hasCloudToken(dataDir())}))

/**
 * Check a Laravel Cloud API token and, when it answers, keep it.
 *
 * The check is the listing of applications, because that is both the one call
 * every cloud connection needs and the one the picker makes: a token that cannot
 * list applications cannot run anything. A token that is refused is not written,
 * so the app never holds one Laravel Cloud has told it is wrong.
 *
 * Only the count of what it saw comes back: a token that works is a fact, and
 * the list belongs to the picker that asks for it.
 */
ipcMain.handle('setCloudToken', async (event, token) => {
  const worth = typeof token === 'string' ? token.trim() : ''

  if (worth === '') {
    return {ok: false, error: {code: 'no_token', message: 'A token is needed before it can be checked.'}}
  }

  try {
    const applications = await cloudApplications(worth)

    if (!secrets.setCloudToken(dataDir(), worth)) {
      return {
        ok: false,
        error: {code: 'failed', message: 'The token was checked but could not be saved.'},
      }
    }

    return {ok: true, applications: applications.length}
  } catch (error) {
    return {ok: false, error: {code: cloudCodeOf(error), message: error.message}}
  }
})

/**
 * Forget the Laravel Cloud API token, so the app asks as nobody again.
 */
ipcMain.handle('forgetCloudToken', async () => {
  secrets.forgetCloudToken(dataDir())

  return {hasToken: secrets.hasCloudToken(dataDir())}
})

/**
 * The applications a token can see, with the environments of each one.
 *
 * This is the picker's question, and the picker asks it when the connection
 * dialog is opened on a cloud connection: the answer is every page Laravel Cloud
 * has, with the environments matched into their application.
 */
ipcMain.handle('listCloudApplications', async () => {
  const token = secrets.cloudToken(dataDir())

  if (!token) {
    return {ok: false, error: {code: 'no_token', message: 'No Laravel Cloud API token is saved.'}}
  }

  try {
    return {ok: true, applications: await cloudApplications(token)}
  } catch (error) {
    return {ok: false, error: {code: cloudCodeOf(error), message: error.message}}
  }
})

/**
 * Open the log viewer for the connection of the window that asked.
 *
 * The window that asks is an editor window: the logs window itself has no logs
 * button, so a press can only come from there. Its connection is read off the
 * window rather than sent with the message, because a window that has switched
 * connection is a fact about the window and not about the message.
 *
 * A connection on Laravel Cloud has no log files this app can read — they are
 * inside the environment, and the API's own log endpoint is not what this viewer
 * is written against — so no window is opened for it. The editor hides the logs
 * button on a cloud connection, so this is the second guard rather than the
 * first: a message from a window that was switched connection a moment ago is
 * not one to open a viewer of some local checkout's logs for.
 */
ipcMain.on('openLogs', event => {
  const connection = getEditorConnection(getEditorConnectionId(windowOf(event)))

  if (!connection) {
    return
  }

  if (isCloud(connection)) {
    log.warn('[logs] logs are not available for Laravel Cloud connections')

    return
  }

  createLogsWindow(connection)
})

ipcMain.on('mcpInfo', event => {
  event.returnValue = mcpInfo()
})

ipcMain.on('popupConnectionContextMenu', (event, id) => {
  connectionContextMenu(id).popup()
})

ipcMain.on('createSnippet', (event, connectionId, snippet) => {
  createSnippet(connectionId, snippet)
})

ipcMain.on('updateSnippet', (event, connectionId, snippet) => {
  updateSnippet(connectionId, snippet)
})

ipcMain.on('allSnippets', (event, connectionId) => {
  event.returnValue = allSnippets(connectionId)
})

ipcMain.on('deleteSnippet', (event, connectionId, snippetId) => {
  deleteSnippet(connectionId, snippetId)
})

ipcMain.on('allHistory', (event, connectionId) => {
  event.returnValue = allHistory(connectionId)
})

ipcMain.on('clearHistory', (event, connectionId) => {
  event.returnValue = clearHistory(connectionId)
})

ipcMain.on('checkForUpdates', () => {
  checkForUpdates()
})

ipcMain.on('downloadUpdate', () => {
  downloadUpdate()
})

ipcMain.on('installUpdate', () => {
  installUpdate()
})

ipcMain.handle('aiComplete', async (event, code) => {
  return await complete(code)
})

ipcMain.handle('aiAsk', async (event, connectionId, request) => {
  const connection = getEditorConnection(connectionId)

  // an `@` in the prompt names a file of the project the connection runs in, and
  // the content goes into the request here rather than through the window
  return await ask(Object.assign({}, request, {
    files: await attachmentsFor(connection, request.prompt),
  }))
})

ipcMain.handle('logFiles', async (event, connectionId) => {
  const connection = getEditorConnection(connectionId)

  // the viewer reads a file on the machine the project runs on: the service asks
  // this one for a local project and the other one for a project over ssh. A
  // cloud connection has no such machine here, and the service says so in its
  // own words, which is what the window shows
  if (!connection) {
    return {dir: '', files: []}
  }

  return logFiles(connection)
})

ipcMain.handle('logRead', async (event, connectionId, name, options) => {
  return readLog(getEditorConnection(connectionId), name, options)
})

ipcMain.handle('aiFiles', async (event, connectionId, typed) => {
  const connection = getEditorConnection(connectionId)

  return await filesFor(connection, typed)
})

ipcMain.handle('aiCheck', async event => {
  return await check()
})

ipcMain.handle('configureMcp', async (event, id) => {
  return configureClient(id)
})

ipcMain.handle('parsePhpForm', async (event, connectionId, code) => {
  return await parsePhpForm(connectionId, code)
})

ipcMain.handle('stringifyPhpForm', async (event, fields, code) => {
  return await stringifyPhpForm(fields, code)
})

ipcMain.handle('phpCompletions', async (event, connectionId, request) => {
  return await phpCompletions(connectionId, request)
})
