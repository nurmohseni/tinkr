const {app} = require('electron')
const Store = require('electron-store')

const {allLocales} = require('../utils/allLocales')

/**
 * Every preference the app has, and what it is worth until it is set.
 *
 * The file on disk holds only what was ever written to it, so this is also what
 * a preference nobody has touched reads as (see services/config.allConfig).
 */
/**
 * The app's own file for a system locale.
 *
 * A system locale carries its region — `pt-BR`, `de-AT` — and there is one file
 * per language, so the language is what is looked for, and English is what is
 * left when there is no file at all.
 *
 * @param {String} system
 * @return {String}
 */
const closestLocale = system => {
  const language = String(system).split('-')[0]

  if (allLocales.indexOf(system) >= 0) {
    return system
  }

  return allLocales.indexOf(language) >= 0 ? language : 'en'
}

const defaults = {
  locale: closestLocale(app.getLocale()),
  command_default: 'php artisan tinker',
  form_switch: true,
  form_prefix: 'field_',
  confirm_close_session: true,
  theme: 'classic',
  // where the result panel sits: 'side' is the code on the left and the result
  // on the right, anything else is one above the other
  editor_layout: 'side',
  // what the result pane shows of a run that has several statements in it: all
  // of them, or only what the last one answered
  result_blocks: 'all',
  shortcut_run: ['Control', 'r'],
  shortcut_new_connection: ['Meta', 'Shift', 'n'],
  // what opens the ai panel and puts the cursor in its prompt
  shortcut_ai: ['Control', 'Shift', 'l'],
  ai_provider: 'openai',
  ai_endpoint: '',
  ai_token: '',
  ai_model: '',
  // whether the editor suggests code at the cursor while you type
  ai_autocomplete: true,
  // how long the editor waits after the last keystroke before it asks for a
  // suggestion, in milliseconds
  ai_delay: 400,
  // the connection the MCP server runs code in when a client does not say which
  // project it is working on: nothing means the client's own directory
  mcp_connection: '',
}

const config = new Store({
  name: 'app/config',
  defaults,
})

module.exports = {
  config,
  defaults,
}
