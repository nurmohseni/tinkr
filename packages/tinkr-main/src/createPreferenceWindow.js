const {BrowserWindow} = require('electron')

const {getEntryUrl, getPreloadEntryUrl} = require('./utils/entryUrl')
const {frameOf} = require('./utils/frame')
const {devIcon} = require('./utils/devIcon')
const {appName} = require('./constants')
const {getIntl} = require('./locale')

// the settings window the app has open, so asking for it twice raises the one
// that is there rather than stacking a second one on it
let preferences = null

/**
 * The settings screen, as a window of its own.
 *
 * It is one window: a press that arrives while it is open raises it, and the
 * section it was asked for is sent to the window that is there. A section
 * arrives as a message rather than as part of the url, because the window is not
 * loaded again for it — the rail is the same rail, and only which of its rows is
 * open changes. The message goes out after the page has loaded, so a section
 * asked for while the window is still starting is not a message nobody is
 * listening for yet.
 *
 * @param {String} [section] the id of the section to open on, or nothing for
 *   the one the screen opens on by itself
 * @return {BrowserWindow}
 */
const createPreferenceWindow = section => {
  if (preferences && !preferences.isDestroyed()) {
    preferences.focus()

    if (section) {
      preferences.webContents.send('preferenceSection', section)
    }

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

  if (section) {
    // the page is loaded and its preload is listening before the section can be
    // heard: sent any earlier, it is a message to a page that does not exist
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send('preferenceSection', section)
      }
    })
  }

  win.on('ready-to-show', () => {
    win.show()
  })

  return win
}

module.exports = {
  createPreferenceWindow,
}
