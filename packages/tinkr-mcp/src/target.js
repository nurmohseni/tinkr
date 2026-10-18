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
 * A name as it was written, short enough to say back: a name is echoed in an
 * error, and a megabyte of one is a megabyte the client is answered with.
 *
 * @param {any} wanted
 * @return {String}
 */
const said = wanted => {
  const text = String(wanted)

  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

/**
 * The connection an id or a name points at.
 *
 * An id is the app's own and points at one connection. A name is compared
 * without case, because that is how people write them, and two connections
 * whose names differ only in case are both what it points at: picking one of
 * them would run code in a place nobody chose, so it is refused and the ids are
 * named instead.
 *
 * @param {String} dir the app's data directory
 * @param {String} wanted an id or a name, as it was written
 * @return {Object|null}
 */
const findConnection = (dir, wanted) => {
  const all = app.connections(dir)
  const byId = all.find(connection => connection.id === wanted)

  if (byId) {
    return byId
  }

  const name = String(wanted).toLowerCase()
  const named = all.filter(connection => String(connection.name || '').toLowerCase() === name)

  if (named.length > 1) {
    throw new Error(
      `More than one connection in Tinkr is called "${said(wanted)}": ` +
      `${named.map(one => `${one.id} (${one.name})`).join(', ')}. Name the one to use by its id.`,
    )
  }

  return named[0] || null
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
 * connection the server was started on: someone who writes one asked for it.
 * Otherwise it is the connection's own command, and when the connection names
 * none, the app's own preference, which is what the app would start it with.
 *
 * @param {Object} connection
 * @param {String} [command]
 * @param {String|null} [dir] the app's data directory, for its preference
 * @return {Object}
 */
const withCommand = (connection, command, dir) => Object.assign({}, connection, {
  command: command || connection.command || (dir && app.command(dir)) || defaultCommand,
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

      throw new Error(`There is no connection "${said(connection)}" in Tinkr. Known connections: ${known}.`)
    }

    return {connection: withCommand(found, command, dir), dataDir: dir, saved: true}
  }

  const project = path.resolve(at || process.cwd())
  const saved = dir
    ? app.connections(dir).find(one => one.path && !one.is_over_ssh && sameDirectory(one.path, project))
    : null

  if (saved) {
    return {connection: withCommand(saved, command, dir), dataDir: dir, saved: true}
  }

  const fallback = command || (dir && app.command(dir)) || defaultCommand

  return {connection: directoryConnection(project, fallback), dataDir: dir, saved: false}
}

module.exports = {
  defaultCommand,
  said,
  sameDirectory,
  findConnection,
  resolve,
}
