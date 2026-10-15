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
const {appName} = require('./constants')

const createEditorWindow = async connection => {
  const {id, name} = connection

  log.info('[window] opening for', connection.name)

  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 800,
    minHeight: 800,
    title: `${appName} - ${name}`,
    webPreferences: {
      preload: getPreloadEntryUrl(),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: true,
    },
  })

  const url = `${getEntryUrl('editor.html')}?id=${id}`

  log.info('[window] loading', url)

  try {
    await win.loadURL(url)

    log.info('[window] loaded')
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
