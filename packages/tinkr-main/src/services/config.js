const {BrowserWindow} = require('electron')

const {config, defaults} = require('../database/config')
const {getIntlConfig, setIntl} = require('../locale')

/**
 * @param {string} lang
 */
const setLocale = lang => {
  config.set('locale', lang)
  const res = getIntlConfig()
  setIntl(res)

  // send the setIntlConfig event to all the windows opened
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('setIntlConfig', res)
  }
}

/**
 * @returns {string}
 */
const getLocale = () => config.get('locale', 'en')

/**
 * @return {string}
 */
const getFormPrefix = () => config.get('form_prefix', 'field_')

/**
 * The app's preferences, as the windows read them.
 *
 * The file on disk holds only what was ever set in it, so the defaults are laid
 * under it: a preference nobody has touched is worth its default, not nothing,
 * and the field that shows it is not empty.
 *
 * @return {Object}
 */
const allConfig = () => Object.assign({}, defaults, config.store)

const setConfig = data => {
  config.set(data)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('setConfig', data)
  }
}

module.exports = {
  setLocale,
  getLocale,
  getFormPrefix,
  allConfig,
  setConfig,
}
