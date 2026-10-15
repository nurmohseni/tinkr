const {BrowserWindow} = require('electron')

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

  await win.loadURL(`${getEntryUrl('editor.html')}?id=${id}`)

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
