const {cloudEnvironment} = require('tinkr-core')

const secrets = require('../database/secrets')
const {dataDir} = require('../utils/dataDir')

/**
 * What a Laravel Cloud connection is, as the one line the terminal says when the
 * window switches to it.
 *
 * A cloud connection has no session to boot, so the terminal that would have
 * shown a shell says what the connection is instead: which application and
 * environment the next run goes to, and what Laravel Cloud says that environment
 * is doing.
 *
 * @param {Record<String, any>} connection
 * @param {{name: String, status: String}} environment
 * @return {String}
 */
const described = (connection, environment) => {
  const application = connection.cloud_application_name || connection.name || ''
  const name = environment.name || connection.cloud_environment_name || ''
  const status = environment.status || 'unknown'

  return `Laravel Cloud · ${[application, name].filter(Boolean).join(' / ')} (${status})`
}

/**
 * Open a Laravel Cloud connection in a window.
 *
 * There is nothing to boot: the code of a cloud connection runs in Laravel
 * Cloud's own container through its API (see createPty), so what the window
 * needs to know is what the environment answers about itself — its php, which
 * the status bar shows, and what it is doing, which is the line the terminal
 * gets instead of a shell's greeting.
 *
 * A failure here is not a failure of the connection: the window stays on it, one
 * line says what Laravel Cloud said, and a run says the same thing again with
 * its own answer. That is why nothing here rejects.
 *
 * @param {Record<String, any>} connection
 * @param {Electron.BrowserWindow} win
 * @return {Promise<void>}
 */
const connectCloud = async (connection, win) => {
  const say = line => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('outputConnection', `${line}\n`)
    }
  }

  const token = secrets.cloudToken(dataDir())

  if (!token) {
    say('Laravel Cloud: no API token is saved. Add one in Preferences → Laravel Cloud.')

    return
  }

  const environmentId = String(connection.cloud_environment_id || '').trim()

  if (!environmentId) {
    say('Laravel Cloud: this connection names no environment. Pick one in its settings.')

    return
  }

  try {
    const environment = await cloudEnvironment(token, environmentId)

    // the window may have been closed, or switched connection, while Laravel
    // Cloud was answering: neither the line nor the version is that window's
    // any more
    if (!win || win.isDestroyed()) {
      return
    }

    say(described(connection, environment))

    // the event the phpVersion service sends, in the shape it sends it, so the
    // status bar reads a cloud connection exactly as it reads a local one
    win.webContents.send('phpVersion', {version: environment.phpVersion || null})
  } catch (error) {
    say(`Laravel Cloud: ${error.message}`)
  }
}

module.exports = {
  connectCloud,
}
