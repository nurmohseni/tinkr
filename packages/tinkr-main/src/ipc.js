const {ipcMain} = require('electron')

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
const {createSnippet, allSnippets, updateSnippet, deleteSnippet} = require('./services/snippets')
const {allHistory, clearHistory} = require('./services/history')
const {parsePhpForm, stringifyPhpForm} = require('./services/php')
const {phpCompletions} = require('./completion')
const {complete, ask, check} = require('./services/ai')
const {providers} = require('./aiProviders')
const {checkForUpdates, downloadUpdate, installUpdate} = require('./updater')
const {info: mcpInfo, configureClient} = require('./services/mcp')
const {filesFor, attachmentsFor} = require('./services/project')
const {files: logFiles, read: readLog} = require('./services/logs')
const {getEditorConnection} = require('./processes')

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

ipcMain.on('connectConnection', async (event, connection) => {
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

ipcMain.on('openPreference', () => {
  createPreferenceWindow()
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
  // this one for a local project and the other one for a project over ssh
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
