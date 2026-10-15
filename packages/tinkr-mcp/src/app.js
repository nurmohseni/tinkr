const fs = require('fs')
const os = require('os')
const path = require('path')

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

/**
 * Read a json file, or nothing when it is not there or unreadable.
 *
 * A file the app has never written is a normal state — a preference nobody
 * touched, a connection with no snippets — and it reads as nothing rather than
 * as a failure.
 *
 * @param {String} file
 * @return {Object|null}
 */
const read = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return null
  }
}

/**
 * The app writes its json with tabs, and a file rewritten by hand here has to
 * stay a file the app can read back.
 *
 * @param {String} file
 * @param {Object} value
 */
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, JSON.stringify(value, null, '\t'))
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

  return Object.values(stored)
}

/**
 * The command a session is started with when the connection names none.
 *
 * @param {String} dir
 * @return {String}
 */
const command = dir => (read(configFile(dir)) || {}).command_default || 'php artisan tinker'

/**
 * @param {String} dir
 * @param {String} connectionId
 * @return {Array<Object>}
 */
const snippets = (dir, connectionId) => Object.values(read(snippetsFile(dir, connectionId)) || {})

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
  const file = snippetsFile(dir, connectionId)
  // the id the app makes for a snippet: nanoid's own alphabet, 21 of it
  const id = require('crypto').randomBytes(16).toString('base64url').slice(0, 21)
  const snippet = {id, code, name, position: {lineNumber: 1, column: 1}}

  const stored = Object.assign({}, read(file))

  stored[id] = snippet
  write(file, stored)

  return snippet
}

module.exports = {
  appDataDir,
  connectionsFile,
  configFile,
  snippetsFile,
  find,
  connections,
  command,
  snippets,
  saveSnippet,
}
