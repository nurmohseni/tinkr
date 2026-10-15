const {app} = require('electron')
const Store = require('electron-store')

const {allLocales} = require('../utils/allLocales')

/**
 * Every preference the app has, and what it is worth until it is set.
 *
 * The file on disk holds only what was ever written to it, so this is also what
 * a preference nobody has touched reads as (see services/config.allConfig).
 */
const defaults = {
  locale: allLocales.indexOf(app.getLocale()) >= 0 ? app.getLocale() : 'en',
  command_default: 'php artisan tinker',
  form_switch: true,
  form_prefix: 'field_',
  confirm_close_session: true,
  theme: 'classic',
  shortcut_run: ['Control', 'r'],
  shortcut_new_connection: ['Meta', 'Shift', 'n'],
  ai_provider: 'openai',
  ai_endpoint: '',
  ai_token: '',
  ai_model: '',
  // whether the editor suggests code at the cursor while you type
  ai_autocomplete: true,
  // how long the editor waits after the last keystroke before it asks for a
  // suggestion, in milliseconds
  ai_delay: 400,
}

const config = new Store({
  name: 'app/config',
  defaults,
})

module.exports = {
  config,
  defaults,
}
