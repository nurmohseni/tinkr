const {BrowserWindow} = require('electron')

const {getEntryUrl, getPreloadEntryUrl} = require('./utils/entryUrl')
const {frameOf} = require('./utils/frame')
const {devIcon} = require('./utils/devIcon')
const {appName} = require('./constants')
const {getIntl} = require('./locale')

// the logs window the app has open, so asking for it twice raises the one that
// is there rather than stacking a second one on it
let logsWindow = null

/**
 * The log viewer, as a window of its own.
 *
 * A log is a document read against the code rather than in it, and reading one
 * inside the editor's pane cost the editor its width every time. The window is
 * the same frame as the settings window — the same titlebar, the same rail — and
 * it is one window: a press that arrives while it is open raises it.
 *
 * The connection travels in the url as the editor's does, so the preload answers
 * every call of this window with the connection it was opened for.
 *
 * @param {Record<String, any>} connection the connection whose logs are read
 * @return {BrowserWindow}
 */
const createLogsWindow = connection => {
  if (logsWindow && !logsWindow.isDestroyed()) {
    logsWindow.focus()

    return logsWindow
  }

  const win = new BrowserWindow({
    // a rail of file names beside the entries themselves, which need the width
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    parent: BrowserWindow.getFocusedWindow(),
    title: `${appName} - ${getIntl().formatMessage({id: 'editor.logs_title'})}`,
    // the same frame as every other window: two windows of one app framed
    // differently is two apps
    ...frameOf(),
    ...devIcon(),
    webPreferences: {
      preload: getPreloadEntryUrl(),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: true,
    },
  })

  logsWindow = win

  win.on('closed', () => {
    logsWindow = null
  })

  win.loadURL(`${getEntryUrl('logs.html')}?id=${connection.id}`)

  win.on('ready-to-show', () => {
    win.show()
  })

  return win
}

/** The logs window, if the app has one open: what a test asks to see it by. */
const getLogsWindow = () => (logsWindow && !logsWindow.isDestroyed() ? logsWindow : null)

module.exports = {
  createLogsWindow,
  getLogsWindow,
}
