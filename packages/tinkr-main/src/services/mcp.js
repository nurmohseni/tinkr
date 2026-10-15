const fs = require('fs')
const os = require('os')
const path = require('path')
const {app} = require('electron')

const {TOOLS} = require('tinkr-mcp')

const {config} = require('../database/config')

/**
 * The MCP server the app ships, and the clients that can be pointed at it.
 *
 * What a client needs is one entry: the program to run, and its arguments. The
 * app knows both — the server is built beside the main process — so it can write
 * that entry into a client's own configuration instead of asking someone to find
 * the file and paste json into it.
 *
 * The clients differ in more than path: Claude Code keeps its configuration
 * inside a file full of its own state and is configured with a command of its
 * own, VS Code names its server list `servers` where everyone else says
 * `mcpServers`, and a client that was renamed has its configuration in the old
 * name's directory too. Each of those is one field of the catalogue below.
 */

/**
 * The server, as a program to run.
 *
 * In a packaged app it sits beside the main process's own bundle and outside the
 * asar: the client starts it with a plain `node`, which cannot read a file inside
 * one. From source it is the package's own entry, where node finds the
 * workspace's modules.
 *
 * @return {String}
 */
const serverPath = () => (app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'main', 'mcp-server.js')
  : path.join(__dirname, '..', '..', '..', 'tinkr-mcp', 'src', 'cli.js'))

/**
 * The entry a client is given.
 *
 * @param {String} server
 * @param {String} [connection] a connection of the app's to run in, when the
 * client's own directory is not what should be run in
 * @return {{command: String, args: Array<String>}}
 */
const entryFor = (server, connection = '') => ({
  command: 'node',
  args: connection ? [server, '--connection', connection] : [server],
})

/**
 * The command that configures Claude Code, which reads a json file of its own
 * only when it is the one to write it.
 *
 * @param {String} server
 * @param {String} [connection]
 * @return {String}
 */
const claudeCommand = (server, connection = '') => [
  'claude mcp add --scope user tinkr -- node',
  `"${server}"`,
  ...(connection ? ['--connection', connection] : []),
].join(' ')

/**
 * Where each client keeps the servers it was told about, and where the client
 * itself is, so that a client that is not installed can say so rather than be
 * written into a directory nobody reads.
 *
 * @param {{platform?: String, home?: String, appData?: String,
 *   configHome?: String}} [where]
 * @return {Array<Object>}
 */
const clientsFor = (where = {}) => {
  const platform = where.platform || process.platform
  const home = where.home || os.homedir()
  const appData = where.appData || process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const configHome = where.configHome || process.env.XDG_CONFIG_HOME || path.join(home, '.config')

  // a client's own data directory, in the place its platform keeps those
  const appDir = name => (platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', name)
    : platform === 'win32' ? path.join(appData, name) : path.join(configHome, name))

  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      key: 'mcpServers',
      // it is configured by its own command, not by a file of ours to write
      kind: 'command',
      signs: [path.join(home, '.claude.json'), path.join(home, '.claude')],
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      key: 'mcpServers',
      kind: 'file',
      file: path.join(appDir('Claude'), 'claude_desktop_config.json'),
      signs: [appDir('Claude')],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      key: 'mcpServers',
      kind: 'file',
      file: path.join(home, '.cursor', 'mcp.json'),
      signs: [path.join(home, '.cursor'), appDir('Cursor')],
    },
    {
      id: 'windsurf',
      name: 'Windsurf / Devin Desktop',
      key: 'mcpServers',
      kind: 'file',
      // it was Windsurf before it was Devin, and the configuration it wrote as
      // Windsurf is the one the same installation still reads
      file: platform === 'win32'
        ? path.join(appData, 'devin', 'mcp_config.json')
        : path.join(configHome, 'devin', 'mcp_config.json'),
      also: [path.join(home, '.codeium', 'windsurf', 'mcp_config.json')],
      signs: [appDir('devin'), path.join(home, '.codeium', 'windsurf')],
    },
    {
      id: 'vscode',
      name: 'VS Code',
      key: 'servers',
      kind: 'file',
      file: path.join(appDir('Code'), 'User', 'mcp.json'),
      signs: [appDir('Code'), appDir('Code - Insiders')],
    },
  ]
}

/**
 * Read a json file that a client owns, or nothing when it is not there.
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
 * The file a client's servers are in: the one it has, when it kept them the way
 * an older version of it did.
 *
 * @param {Object} client
 * @return {String}
 */
const fileOf = client => (client.also || []).find(file => fs.existsSync(file)) || client.file

/**
 * Whether the client is on this machine at all.
 *
 * @param {Object} client
 * @return {Boolean}
 */
const installed = client => (client.signs || []).some(sign => fs.existsSync(sign))

/**
 * Whether the client is already pointed at this app.
 *
 * @param {Object} client
 * @return {Boolean}
 */
const configured = client => {
  const stored = read(fileOf(client))

  return Boolean(stored && stored[client.key] && stored[client.key].tinkr)
}

/**
 * Point a client at the server, in a file that is the client's own and holds
 * whatever else it holds: only the one entry is replaced.
 *
 * @param {Object} client
 * @param {Object} entry
 * @return {String} the file that was written
 */
const configure = (client, entry) => {
  const file = fileOf(client)
  const stored = Object.assign({}, read(file))
  const servers = Object.assign({}, stored[client.key])

  servers.tinkr = entry
  stored[client.key] = servers

  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, JSON.stringify(stored, null, 2))

  return file
}

/**
 * Everything the settings screen says about the server: where it is, what a
 * client is given, and which clients are on this machine and where they stand.
 *
 * @return {Object}
 */
const info = () => {
  const server = serverPath()
  const connection = config.get('mcp_connection', '') || ''
  const entry = entryFor(server, connection)

  return {
    server,
    connection,
    entry,
    command: claudeCommand(server, connection),
    config: {mcpServers: {tinkr: entry}},
    tools: TOOLS.map(tool => tool.name),
    clients: clientsFor().map(client => ({
      id: client.id,
      name: client.name,
      kind: client.kind,
      key: client.key,
      file: client.kind === 'file' ? fileOf(client) : null,
      installed: installed(client),
      configured: client.kind === 'file' && configured(client),
    })),
  }
}

/**
 * Point one client at the server, as the preferences stand right now.
 *
 * @param {String} id
 * @return {{file: String, info: Object}} what was written, and the screen's
 * answer after it, so that a window does not have to ask twice
 */
const configureClient = id => {
  const client = clientsFor().find(one => one.id === id)

  if (!client) {
    throw new Error(`There is no client called ${id}`)
  }

  if (client.kind !== 'file') {
    throw new Error(`${client.name} keeps its own configuration: give it the command instead.`)
  }

  return {
    file: configure(client, entryFor(serverPath(), config.get('mcp_connection', '') || '')),
    info: info(),
  }
}

module.exports = {
  serverPath,
  entryFor,
  claudeCommand,
  clientsFor,
  fileOf,
  installed,
  configured,
  configure,
  configureClient,
  info,
}
