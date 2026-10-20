const fs = require('fs')
const os = require('os')
const path = require('path')

// the main process runs inside electron, and a test has none: the package's own
// mock is what the service reads, and it is what these set up and put back
const {app} = require('electron')

const mcp = require('../services/mcp')

// a client, as the catalogue describes one, with its file inside a test's own
// directory rather than where the machine keeps it
const client = (dir, overrides = {}) => Object.assign({
  id: 'cursor',
  name: 'Cursor',
  key: 'mcpServers',
  kind: 'file',
  file: path.join(dir, 'mcp.json'),
  signs: [],
}, overrides)

describe('where a client is pointed at the server', () => {
  const clients = where => Object.fromEntries(mcp.clientsFor(where).map(one => [one.id, one]))

  test('each client keeps its servers where its platform keeps them', () => {
    const linux = clients({platform: 'linux', home: '/home/dev', configHome: '/home/dev/.config'})
    // a fake home carries its config home too: the real one is read from the
    // environment when a caller does not name it
    const mac = clients({platform: 'darwin', home: '/Users/dev', configHome: '/Users/dev/.config'})
    const windows = clients({
      platform: 'win32',
      home: 'C:\\Users\\dev',
      appData: 'C:\\Users\\dev\\AppData\\Roaming',
    })

    expect(linux.cursor.file).toBe('/home/dev/.cursor/mcp.json')
    expect(linux['claude-desktop'].file).toBe('/home/dev/.config/Claude/claude_desktop_config.json')
    expect(linux.windsurf.file).toBe('/home/dev/.config/devin/mcp_config.json')
    expect(linux.vscode.file).toBe('/home/dev/.config/Code/User/mcp.json')

    expect(mac['claude-desktop'].file)
      .toBe('/Users/dev/Library/Application Support/Claude/claude_desktop_config.json')
    expect(mac.windsurf.file).toBe('/Users/dev/.config/devin/mcp_config.json')

    expect(windows['claude-desktop'].file)
      .toBe(path.join('C:\\Users\\dev\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'))
    expect(windows.vscode.file)
      .toBe(path.join('C:\\Users\\dev\\AppData\\Roaming', 'Code', 'User', 'mcp.json'))
  })

  test('a client names its servers the way that client names them', () => {
    const linux = clients({platform: 'linux', home: '/home/dev', configHome: '/home/dev/.config'})

    expect(linux.cursor.key).toBe('mcpServers')
    expect(linux['claude-desktop'].key).toBe('mcpServers')
    expect(linux.vscode.key).toBe('servers')
  })

  test('Claude Code is configured with a command, not a file of ours', () => {
    const linux = clients({platform: 'linux', home: '/home/dev', configHome: '/home/dev/.config'})

    expect(linux['claude-code'].kind).toBe('command')
    expect(linux['claude-code'].file).toBeUndefined()
  })
})

describe('the entry a client is given', () => {
  test('runs the server, and names the connection when one is chosen', () => {
    expect(mcp.entryFor('/app/main/mcp-server.js'))
      .toEqual({command: 'node', args: ['/app/main/mcp-server.js']})

    expect(mcp.entryFor('/app/main/mcp-server.js', 'abc123'))
      .toEqual({command: 'node', args: ['/app/main/mcp-server.js', '--connection', 'abc123']})
  })

  test('Claude Code is given the command that writes its own configuration', () => {
    expect(mcp.claudeCommand('/app/main/mcp-server.js'))
      .toBe('claude mcp add --scope user tinkr -- node "/app/main/mcp-server.js"')

    expect(mcp.claudeCommand('/app/main/mcp-server.js', 'abc123'))
      .toBe('claude mcp add --scope user tinkr -- node "/app/main/mcp-server.js" --connection abc123')
  })
})

describe('writing a client\'s configuration', () => {
  let dir

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-mcp-'))
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  test('keeps every server the client already had, and what else is in its file', () => {
    const one = client(dir)

    fs.writeFileSync(one.file, JSON.stringify({mcpServers: {other: {command: 'x'}}, theme: 'dark'}, null, 2))

    expect(mcp.configure(one, mcp.entryFor('/s.js'))).toBe(one.file)

    expect(JSON.parse(fs.readFileSync(one.file, 'utf8'))).toEqual({
      theme: 'dark',
      mcpServers: {
        other: {command: 'x'},
        tinkr: {command: 'node', args: ['/s.js']},
      },
    })
  })

  test('writes the file a client under another name kept its servers in', () => {
    const legacy = path.join(dir, 'legacy.json')

    fs.writeFileSync(legacy, '{}')

    const one = client(dir, {also: [legacy]})

    expect(mcp.fileOf(one)).toBe(legacy)
    expect(mcp.configure(one, mcp.entryFor('/s.js'))).toBe(legacy)
  })

  test('says whether a client is pointed at this app already', () => {
    const one = client(dir)

    expect(mcp.configured(one)).toBe(false)

    mcp.configure(one, mcp.entryFor('/s.js'))

    expect(mcp.configured(one)).toBe(true)
  })

  test('a client that is not on this machine is one nobody reads', () => {
    expect(mcp.installed(client(dir, {signs: [path.join(dir, 'nowhere')]}))).toBe(false)

    fs.mkdirSync(path.join(dir, 'there'))

    expect(mcp.installed(client(dir, {signs: [path.join(dir, 'there')]}))).toBe(true)
  })

  test('a client the app has no case for is not configured', () => {
    expect(() => mcp.configureClient('nothing')).toThrow(/no client called nothing/)
  })
})

describe('what the settings screen is told', () => {
  test('the server is the app\'s own, and the tools are the server\'s own', () => {
    const info = mcp.info()

    expect(info.server).toMatch(/tinkr-mcp[\\/]src[\\/]cli\.js$/)
    expect(info.entry).toEqual({command: 'node', args: [info.server]})
    expect(info.config).toEqual({mcpServers: {tinkr: info.entry}})
    expect(info.clients.map(one => one.id))
      .toEqual(['claude-code', 'claude-desktop', 'cursor', 'windsurf', 'vscode'])

    // the settings screen lists what the server offers, and the server is what
    // says what that is
    expect(info.tools).toEqual([
      'tinkr_documentation',
      'tinkr_run_php',
      'tinkr_run_php_over_ssh',
      'tinkr_list_history',
      'tinkr_read_run',
      'tinkr_list_connections',
      'tinkr_list_snippets',
      'tinkr_save_snippet',
      'tinkr_delete_snippet',
    ])
  })
})

/**
 * A packaged app, mounted where the system mounted it: the AppImage's own FUSE
 * directory, which holds the resources and goes away with the app.
 *
 * @param {{appImage?: Boolean}} options whether the mount is an AppImage's
 * @return {{mount: String, userData: String, restore: Function}}
 */
const packaged = ({appImage = true} = {}) => {
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'mount_tinkr.'))
  const main = path.join(mount, 'resources', 'app.asar.unpacked', 'main')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-data-'))

  fs.mkdirSync(path.join(main, 'build', 'Release'), {recursive: true})
  fs.writeFileSync(path.join(main, 'mcp-server.js'), 'module.exports = {started: true}\n')
  fs.writeFileSync(path.join(main, 'build', 'Release', 'pty.node'), 'binary')

  const real = {
    resourcesPath: Object.getOwnPropertyDescriptor(process, 'resourcesPath'),
    appdir: process.env.APPDIR,
    isPackaged: app.isPackaged,
    getPath: app.getPath,
    getVersion: app.getVersion,
  }

  Object.defineProperty(process, 'resourcesPath', {
    value: path.join(mount, 'resources'),
    configurable: true,
  })

  if (appImage) {
    process.env.APPDIR = mount
  } else {
    delete process.env.APPDIR
  }

  app.isPackaged = true
  app.getPath = () => userData
  app.getVersion = () => '9.9.9'

  return {
    mount,
    userData,
    restore: () => {
      if (real.resourcesPath) {
        Object.defineProperty(process, 'resourcesPath', real.resourcesPath)
      } else {
        delete process.resourcesPath
      }

      if (real.appdir === undefined) {
        delete process.env.APPDIR
      } else {
        process.env.APPDIR = real.appdir
      }

      app.isPackaged = real.isPackaged
      app.getPath = real.getPath
      app.getVersion = real.getVersion

      fs.rmSync(mount, {recursive: true, force: true})
      fs.rmSync(userData, {recursive: true, force: true})
    },
  }
}

describe('the server path a packaged app hands out', () => {
  let mounted = null

  afterEach(() => {
    if (mounted) {
      mounted.restore()
      mounted = null
    }
  })

  // the bug this waits against: an AppImage's mount is gone the moment the app
  // closes and its random suffix changes on every launch, so the entry the
  // settings screen wrote failed on the client's next start with
  // `Cannot find module`
  test('an AppImage gets a copy that outlives the app being closed', () => {
    mounted = packaged()
    const server = mcp.serverPath()

    expect(server.startsWith(mounted.mount)).toBe(false)
    expect(server.startsWith(mounted.userData)).toBe(true)
    expect(fs.existsSync(server)).toBe(true)
    // the native module travels with it, because the server loads it relative
    // to its own directory
    expect(fs.existsSync(path.join(path.dirname(server), 'build', 'Release', 'pty.node'))).toBe(true)

    // the app closes, and the mount is gone: the copy is not
    fs.rmSync(mounted.mount, {recursive: true, force: true})

    expect(fs.existsSync(server)).toBe(true)
    expect(require(server)).toEqual({started: true})
  })

  test('a second launch mounted somewhere else hands out the same path', () => {
    mounted = packaged()
    const first = mcp.serverPath()

    // a new mount, a new random suffix, and the same version
    const second = packedMountAgain(mounted)

    expect(second).toBe(first)
  })

  test('an installed build is pointed at its own resources, which are permanent', () => {
    mounted = packaged({appImage: false})

    expect(mcp.serverPath())
      .toBe(path.join(mounted.mount, 'resources', 'app.asar.unpacked', 'main', 'mcp-server.js'))
    expect(fs.existsSync(path.join(mounted.userData, 'mcp-server-9.9.9'))).toBe(false)
  })
})

/**
 * Remount a packaged app somewhere else, as a second AppImage launch does.
 *
 * @param {{mount: String}} mounted
 * @return {String} the server path the new mount hands out
 */
const packedMountAgain = mounted => {
  const again = fs.mkdtempSync(path.join(os.tmpdir(), 'mount_tinkr.'))
  const main = path.join(again, 'resources', 'app.asar.unpacked', 'main')

  fs.mkdirSync(path.join(main, 'build', 'Release'), {recursive: true})
  fs.writeFileSync(path.join(main, 'mcp-server.js'), 'module.exports = {started: true}\n')
  fs.writeFileSync(path.join(main, 'build', 'Release', 'pty.node'), 'binary')

  Object.defineProperty(process, 'resourcesPath', {
    value: path.join(again, 'resources'),
    configurable: true,
  })
  process.env.APPDIR = again

  try {
    return mcp.serverPath()
  } finally {
    fs.rmSync(again, {recursive: true, force: true})
  }
}

describe('the snippets a connection has, watched', () => {
  const {watchSnippets} = require('../services/snippetsWatch')

  let dir = null
  let win = null
  let watcher = null

  // the watcher holds the process open, so it is closed whether the test passed
  // or threw: a watch left running is a jest that never exits
  const watching = (connectionId, read) => {
    watcher = watchSnippets(win, connectionId, read)

    return watcher
  }

  const settle = () => new Promise(resolve => setTimeout(resolve, 250))

  const sent = () => win.webContents.send.mock.calls.filter(([channel]) => channel === 'snippetsConnection')

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-watch-'))
    win = {webContents: {send: jest.fn()}, isDestroyed: () => false}
    app.getPath = () => dir
  })

  afterEach(() => {
    if (watcher) {
      watcher.close()
      watcher = null
    }

    fs.rmSync(dir, {recursive: true, force: true})
    app.getPath = () => '/tmp'
  })

  // the bug this waits against: an agent saved a snippet through the MCP server,
  // and the window kept showing the list it had read when it switched connection
  // until it was closed and opened again
  test('tells the window what a snippet saved outside the app is', async () => {
    const file = path.join(dir, 'app', 'snippets', 'one.json')
    const watcherOf = watching('one', () => JSON.parse(fs.readFileSync(file, 'utf8')))

    expect(watcherOf).not.toBeNull()

    fs.mkdirSync(path.dirname(file), {recursive: true})
    // written the way the MCP server writes it: a file of its own, renamed over
    fs.writeFileSync(`${file}.tinkr-tmp`, JSON.stringify({abc: {id: 'abc', name: 'One', code: '$n = 1;'}}))
    fs.renameSync(`${file}.tinkr-tmp`, file)

    await settle()

    expect(sent()).toHaveLength(1)
    // the store's shape is the file's: a snippet by its id
    expect(sent()[0][1]).toEqual({
      connection: 'one',
      snippets: {abc: {id: 'abc', name: 'One', code: '$n = 1;'}},
    })
  })

  test('does not redraw the window for a rewrite that says the same thing', async () => {
    const file = path.join(dir, 'app', 'snippets', 'one.json')
    const held = {abc: {id: 'abc', name: 'One', code: '$n = 1;'}}

    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, JSON.stringify(held))

    watching('one', () => JSON.parse(fs.readFileSync(file, 'utf8')))

    // the app's own save looks like this from out here: the same content, written
    // again in the way electron-store writes it
    await settle()

    const before = sent().length

    fs.writeFileSync(file, JSON.stringify(held, null, 2))

    await settle()

    expect(sent().length).toBe(before)
  })
})
