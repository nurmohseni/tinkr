const {vaporEnvironments} = require('tinkr-core')

const secrets = require('../database/secrets')
const {getEditorWindow} = require('../processes')
const {dataDir} = require('../utils/dataDir')

/**
 * What a Laravel Vapor connection is, as the one line the terminal says when the
 * window switches to it.
 *
 * A Vapor connection has no session to boot either, so the terminal that would
 * have shown a shell says what the connection is instead: which project and
 * environment the next run goes to. Vapor's own environment list carries no
 * status and no php version, so there is nothing more this line could honestly
 * say.
 *
 * @param {Record<String, any>} connection
 * @param {{name: String}} environment
 * @return {String}
 */
const described = (connection, environment) => {
  const project = connection.vapor_project_name || connection.name || ''
  const name = environment.name || connection.vapor_environment_name || ''

  return `Laravel Vapor · ${[project, name].filter(Boolean).join(' / ')}`
}

/**
 * Open a Laravel Vapor connection in a window.
 *
 * There is nothing to boot: the code of a Vapor connection runs in the
 * environment's own lambda through its API (see createPty), so what the window
 * needs to know is what that environment answers about itself — its name, and
 * nothing about its php, because Vapor's environment list does not report one.
 *
 * A failure here is not a failure of the connection: the window stays on it, one
 * line says what Vapor said, and a run says the same thing again with its own
 * answer. That is why nothing here rejects.
 *
 * @param {Record<String, any>} connection
 * @param {Electron.BrowserWindow} win
 * @return {Promise<void>}
 */
const connectVapor = async (connection, win) => {
  // the app keeps one window and switches its connection in place, so a window
  // this connection was opened in is not enough: Vapor answers later, and by
  // then the window may be closed or showing another connection. What arrives
  // then is that other connection's window to write to, not this one's
  const showsThisConnection = () =>
    Boolean(win) && !win.isDestroyed() && getEditorWindow(connection.id) === win

  const say = line => {
    if (showsThisConnection()) {
      win.webContents.send('outputConnection', `${line}\n`)
    }
  }

  const token = secrets.vaporToken(dataDir())

  if (!token) {
    say('Laravel Vapor: no API token is saved. Add one in Preferences → Laravel Vapor.')

    return
  }

  const projectId = String(connection.vapor_project_id || '').trim()
  const environmentId = String(connection.vapor_environment_id || '').trim()

  if (!projectId || !environmentId) {
    say('Laravel Vapor: this connection names no project and environment. Pick them in its settings.')

    return
  }

  try {
    const environments = await vaporEnvironments(token, projectId)

    // the window may have been closed, or switched connection, while Vapor was
    // answering: neither the line nor the version is that window's any more
    if (!showsThisConnection()) {
      return
    }

    // the environment list is the project's, so an environment that is not in it
    // has been deleted or renamed since the connection was saved: saying its name
    // anyway would be naming something that is not there to run in
    const environment = environments.find(one => one.id === environmentId)

    if (!environment) {
      say(
        `Laravel Vapor: ${connection.vapor_environment_name || 'this environment'} ` +
        'is not in the project any more.',
      )

      return
    }

    say(described(connection, environment))

    // the event the phpVersion service sends, in the shape it sends it, so the
    // status bar reads a Vapor connection exactly as it reads a local one. Vapor
    // reports no php version for an environment, and null is the status bar's
    // way of being told there is none rather than of showing a stale one
    win.webContents.send('phpVersion', {version: null})
  } catch (error) {
    say(`Laravel Vapor: ${error.message}`)
  }
}

module.exports = {
  connectVapor,
}
