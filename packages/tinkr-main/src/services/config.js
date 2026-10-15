const {BrowserWindow} = require('electron')

const {config, defaults} = require('../database/config')
const {getIntlConfig, setIntl} = require('../locale')

/**
 * @param {string} lang
 */
/**
 * Switch the language.
 *
 * The write is what tells the windows: each one reads the config the main
 * process holds, and a window that asks for its messages gets the ones of the
 * locale in it — which is how it gets them at startup too. Nothing is pushed at
 * them, because a pushed message is a second way to say the same thing and this
 * one arrives.
 *
 * What the main process speaks is switched here as well, since its own menus are
 * built from those messages.
 */
const setLocale = lang => {
  setConfig({locale: lang})

  setIntl(getIntlConfig())
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
