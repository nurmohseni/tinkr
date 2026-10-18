const {BrowserWindow} = require('electron')
const log = require('electron-log')

const {createPty} = require('./createPty')
const {detectPhpVersion} = require('./services/phpVersion')
const {createBackgroundPty} = require('./createBackgroundPty')
const {
  setEditorWindow,
  setEditorConnection,
  getEditorConnectionId,
  killPtys,
} = require('./processes')
const {getEntryUrl, getPreloadEntryUrl} = require('./utils/entryUrl')
const {frameOf} = require('./utils/frame')
const {devIcon} = require('./utils/devIcon')
const {appName} = require('./constants')

const createEditorWindow = async connection => {
  const {id, name} = connection

  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 800,
    minHeight: 800,
    title: `${appName} - ${name}`,
    // the window draws its own titlebar: the platform's frame would be a second
    // one, and on windows a menu bar a third. The design's titlebar is already
    // the drag region, so the frame is only the shadow and the resize edges
    ...frameOf(),
    ...devIcon(),
    webPreferences: {
      preload: getPreloadEntryUrl(),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: true,
    },
  })

  // what the page says goes into the same log, so a script that threw is a line
  // here rather than a window that does nothing
  win.webContents.on('console-message', e => {
    if (e.level === 'error') {
      log.error('[renderer]', e.message, e.lineNumber ? `(${e.sourceId}:${e.lineNumber})` : '')
    }
  })

  win.webContents.on('preload-error', (event, preloadPath, error) => {
    log.error('[window] the preload did not run:', preloadPath, '-', error.message)
  })

  win.webContents.on('render-process-gone', (event, details) => {
    log.error('[window] the renderer went away:', details.reason)
  })

  const url = `${getEntryUrl('editor.html')}?id=${id}`

  try {
    await win.loadURL(url)
  } catch (e) {
    // a window whose page did not load is a blank one, and the reason is here
    // rather than anywhere a user can see it
    log.error('[window] the page did not load:', e.message)
  }

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('closed', () => {
    // the window is loaded again when it switches connection, so the connection
    // it runs is read off the window rather than off the id it was made for.
    // Nothing takes its place: the last window gone leaves the app windowless,
    // which is what quits it.
    const closedId = getEditorConnectionId(win)

    if (!closedId) {
      return
    }

    setEditorWindow(closedId, null)
    setEditorConnection(closedId, null)

    // 清理 pty
    killPtys(closedId)
  })

  setEditorWindow(id, win)
  setEditorConnection(id, connection)

  createPty(connection)
  createBackgroundPty(connection)

  detectPhpVersion(connection, win)

  return win
}

module.exports = {
  createEditorWindow,
}
