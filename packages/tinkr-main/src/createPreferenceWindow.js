const {BrowserWindow} = require('electron')

const {getEntryUrl, getPreloadEntryUrl} = require('./utils/entryUrl')
const {frameOf} = require('./utils/frame')
const {devIcon} = require('./utils/devIcon')
const {appName} = require('./constants')
const {getIntl} = require('./locale')

// the settings window the app has open, so asking for it twice raises the one
// that is there rather than stacking a second one on it
let preferences = null

const createPreferenceWindow = () => {
  if (preferences && !preferences.isDestroyed()) {
    preferences.focus()

    return preferences
  }

  const win = new BrowserWindow({
    // the settings screen is a rail plus one column of setting rows, which does
    // not fit in a dialog sized window
    width: 880,
    height: 660,
    minWidth: 720,
    minHeight: 520,
    parent: BrowserWindow.getFocusedWindow(),
    title: `${appName} - ${getIntl().formatMessage({id: 'preference.preferences'})}`,
    // the same frame as the editor window: the settings screen draws the same
    // titlebar, because two windows of one app framed differently is two apps
    ...frameOf(),
    ...devIcon(),
    webPreferences: {
      preload: getPreloadEntryUrl(),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: true,
    },
  })

  preferences = win

  win.on('closed', () => {
    preferences = null
  })

  win.loadURL(getEntryUrl('preference.html'))

  win.on('ready-to-show', () => {
    win.show()
  })

  return win
}

module.exports = {
  createPreferenceWindow,
}
