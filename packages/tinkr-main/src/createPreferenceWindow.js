const {BrowserWindow} = require('electron')

const {getEntryUrl, getPreloadEntryUrl} = require('./utils/entryUrl')
const {appName} = require('./constants')
const {getIntl} = require('./locale')

const createPreferenceWindow = () => {
  const win = new BrowserWindow({
    // the settings screen is a rail plus one column of setting rows, which does
    // not fit in a dialog sized window
    width: 880,
    height: 660,
    minWidth: 720,
    minHeight: 520,
    parent: BrowserWindow.getFocusedWindow(),
    title: `${appName} - ${getIntl().formatMessage({id: 'preference.preferences'})}`,
    webPreferences: {
      preload: getPreloadEntryUrl(),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: true,
    },
  })

  win.loadURL(getEntryUrl('preference.html'))

  win.on('ready-to-show', () => {
    win.show()
  })
}

module.exports = {
  createPreferenceWindow,
}
