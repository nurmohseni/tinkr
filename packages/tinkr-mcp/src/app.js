const fs = require('fs')
const os = require('os')
const path = require('path')

const {readJson, updateJson} = require('./files')

/**
 * The app's own files, read by a process that is not the app.
 *
 * The MCP server is started by an AI tool, not by Tinkr, so there is no
 * electron-store to ask and no window to reach: the connections, the snippets
 * and the preferences are read from the json files the app keeps them in.
 *
 * Where those files are is the one thing that is not the same everywhere.
 * Electron answers "the app's data directory" from the platform and from the
 * name the app runs under, which is the packaged name in a release and the
 * package's own name when the app runs from source, so both are looked for — and
 * a directory named with `--data-dir` replaces the search.
 */
const appNames = ['Tinkr', 'tinkr-main']

/**
 * @return {String} where a system keeps its applications' data
 */
const appDataDir = () => {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support')
  }

  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  }

  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
}

const connectionsFile = dir => path.join(dir, 'app', 'connections.json')
const configFile = dir => path.join(dir, 'app', 'config.json')
const snippetsFile = (dir, connectionId) => path.join(dir, 'app', 'snippets', `${connectionId}.json`)
const historyFile = (dir, connectionId) => path.join(dir, 'app', 'history', `${connectionId}.json`)

/**
 * @param {any} value
 * @return {Boolean} whether it is an object with fields, the only thing an entry
 * of the app's files can be
 */
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Read one of the app's json files, or nothing when it is not there.
 *
 * A file the app has never written is a normal state — a preference nobody
 * touched, a connection with no snippets — and it reads as nothing. A file that
 * is there and cannot be read is an error that names it: read as nothing, it
 * would list as empty, and a snippet saved on top of it would delete everything
 * it held.
 *
 * @param {String} file
 * @return {Object|null}
 */
const read = file => {
  const value = readJson(file)

  if (value !== null && !isRecord(value)) {
    throw new Error(`${file} does not hold a JSON object, so it was left as it is.`)
  }

  return value
}

/**
 * Where the app's data is: the directory named on the command line, or the
 * first place the app's own files are.
 *
 * @param {String} [dataDir]
 * @return {String|null}
 */
const find = dataDir => {
  const candidates = dataDir
    ? [path.resolve(dataDir)]
    : appNames.map(name => path.join(appDataDir(), name))

  return candidates.find(dir => fs.existsSync(connectionsFile(dir))) || null
}

/**
 * The connections the app lists, as the app lists them.
 *
 * The quick connection is the session the folder button boots rather than one
 * of the connections, so it is left out here the way it is left out of the app's
 * own list.
 *
 * @param {String} dir
 * @return {Array<Object>}
 */
const connections = dir => {
  const stored = Object.assign({}, read(connectionsFile(dir)))

  delete stored.quick_connection

  return Object.values(stored).filter(isRecord)
}

/**
 * The command a session is started with when the connection names none.
 *
 * @param {String} dir
 * @return {String}
 */
const command = dir => (read(configFile(dir)) || {}).command_default || 'php artisan tinker'

/**
 * Where a connection keeps its log files, as the app's preferences say: relative
 * to the project, and `storage/logs` when nobody has said otherwise.
 *
 * It is a preference rather than a guess because a project can keep them
 * anywhere, and a reader that looked in the wrong directory would answer "no
 * logs" about a project full of them.
 *
 * @param {String} dir
 * @return {String}
 */
const logDir = dir => (read(configFile(dir)) || {}).log_dir || 'storage/logs'

/**
 * @param {String} dir
 * @param {String} connectionId
 * @return {Array<Object>}
 */
const snippets = (dir, connectionId) => Object.values(read(snippetsFile(dir, connectionId)) || {}).filter(isRecord)

/**
 * The runs a connection has kept, newest first, as the app's own sidebar lists
 * them: the code that ran, when, how it ended, and as much of what came back as
 * the entry holds (`cut` names the parts that were too big to keep).
 *
 * Written by the app rather than by this server: the app holds the list in memory
 * while it runs, so a second writer would lose one of them.
 *
 * @param {String} dir
 * @param {String} connectionId
 * @return {Array<Object>}
 */
const history = (dir, connectionId) => {
  const {entries} = read(historyFile(dir, connectionId)) || {}

  // an entry is whatever the file holds: an older app's, or one edited by hand,
  // may be missing a field, and one odd entry must not hide the others
  return Array.isArray(entries)
    ? entries.filter(isRecord)
    : []
}

/**
 * Keep a snippet of a connection, the way the app's own Save does.
 *
 * A snippet is the code, the name it was given and where the caret was, which
 * is what the editor restores when the snippet is opened again.
 *
 * @param {String} dir
 * @param {String} connectionId
 * @param {String} name
 * @param {String} code
 * @return {Object} the snippet, as it was stored
 */
const saveSnippet = (dir, connectionId, name, code) => {
  // the id the app makes for a snippet: nanoid's own alphabet, 21 of it
  const id = require('crypto').randomBytes(16).toString('base64url').slice(0, 21)
  const snippet = {id, code, name, position: {lineNumber: 1, column: 1}}

  // the app and every other MCP server write this file too: the change is made
  // under the lock they all take, on top of what the file holds right then, and
  // written whole (see files.updateJson)
  updateJson(
    snippetsFile(dir, connectionId),
    stored => Object.assign(stored, {[id]: snippet}),
    stored => Boolean(stored[id]),
  )

  return snippet
}

/**
 * Delete a snippet of a connection, the way the app's own delete does.
 *
 * The snippet is removed from the file under the lock every writer takes, on top
 * of what the file holds right then, so a snippet another writer saved a moment
 * ago is not lost with it. A snippet that is not there is not an error — the
 * answer says it was already gone — because a delete that is asked for twice is
 * still a delete that happened.
 *
 * @param {String} dir
 * @param {String} connectionId
 * @param {String} id
 * @return {{id: String, name: String|null, deleted: Boolean}} what was done
 */
const deleteSnippet = (dir, connectionId, id) => {
  // what the file holds right now, so the answer can say what was removed
  const held = (read(snippetsFile(dir, connectionId)) || {})[id]
  let removed = false

  updateJson(
    snippetsFile(dir, connectionId),
    stored => {
      if (!Object.prototype.hasOwnProperty.call(stored, id)) {
        return stored
      }

      removed = true

      const rest = Object.assign({}, stored)

      delete rest[id]

      return rest
    },
    () => true,
  )

  return {
    id,
    name: held && typeof held.name === 'string' ? held.name : null,
    deleted: removed,
  }
}

module.exports = {
  appDataDir,
  connectionsFile,
  configFile,
  snippetsFile,
  historyFile,
  history,
  find,
  connections,
  command,
  logDir,
  snippets,
  saveSnippet,
  deleteSnippet,
}
