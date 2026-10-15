const path = require('path')

const app = require('./app')

/**
 * What code runs in.
 *
 * A run needs a connection: a directory to run in, a command to start the
 * session with, and — when it is one of the app's — an id, so that the snippets
 * and the history a run touches are that connection's.
 *
 * Three ways to say which one, in the order they are tried: the connection named
 * on the command line (or on the call), the app's own connection whose directory
 * is the one the server was started in, and the directory itself. The last one
 * is what makes the server useful in a project the app has never been opened on:
 * a client that starts it in a checkout gets a session in that checkout.
 */
const defaultCommand = 'php artisan tinker'

/**
 * @param {String} one
 * @param {String} other
 * @return {Boolean} whether the two name the same directory, however they were
 * written (`/app`, `/app/`, `/app/.`)
 */
const sameDirectory = (one, other) => {
  try {
    return path.resolve(one) === path.resolve(other)
  } catch (e) {
    return false
  }
}

/**
 * @param {String} dir the app's data directory
 * @param {String} wanted an id or a name, as it was written
 * @return {Object|null}
 */
const findConnection = (dir, wanted) => {
  const name = String(wanted).toLowerCase()

  return app.connections(dir).find(connection =>
    connection.id === wanted || String(connection.name || '').toLowerCase() === name) || null
}

/**
 * The connection a directory is, as a connection: what the app would have
 * created for it.
 *
 * @param {String} at an absolute directory
 * @param {String} [command]
 * @return {Object}
 */
const directoryConnection = (at, command) => ({
  id: 'cwd',
  name: path.basename(at) || at,
  path: at,
  command: command || defaultCommand,
  is_over_ssh: false,
})

/**
 * The connection a run of the app's own, and the command it is started with.
 *
 * A command named on the command line is the one that runs, whichever
 * connection it is: someone who writes one asked for it, and a connection that
 * names its own command is only the fallback.
 *
 * @param {Object} connection
 * @param {String} [command]
 * @return {Object}
 */
const withCommand = (connection, command) => Object.assign({}, connection, {
  command: command || connection.command || defaultCommand,
})

/**
 * @param {{connection?: String, at?: String, command?: String,
 *   dataDir?: String}} [options] `at` is a directory, `connection` an id or name
 * @return {{connection: Object, dataDir: String|null, saved: Boolean}} `saved` says
 * whether the connection is one the app knows, which is what a snippet needs
 */
const resolve = (options = {}) => {
  const {connection, at, command, dataDir} = options
  const dir = app.find(dataDir)

  if (connection) {
    if (!dir) {
      throw new Error(
        'Tinkr\'s own data was not found, so there is no connection to look a name up in. ' +
        'Pass where the app keeps it with --data-dir, or a directory to run in with --path.',
      )
    }

    const found = findConnection(dir, connection)

    if (!found) {
      const known = app.connections(dir).map(one => `${one.id} (${one.name})`).join(', ') || 'none'

      throw new Error(`There is no connection "${connection}" in Tinkr. Known connections: ${known}.`)
    }

    return {connection: withCommand(found, command), dataDir: dir, saved: true}
  }

  const project = path.resolve(at || process.cwd())
  const saved = dir
    ? app.connections(dir).find(one => one.path && !one.is_over_ssh && sameDirectory(one.path, project))
    : null

  if (saved) {
    return {connection: withCommand(saved, command), dataDir: dir, saved: true}
  }

  const fallback = command || (dir && app.command(dir)) || defaultCommand

  return {connection: directoryConnection(project, fallback), dataDir: dir, saved: false}
}

module.exports = {
  defaultCommand,
  sameDirectory,
  findConnection,
  resolve,
}
