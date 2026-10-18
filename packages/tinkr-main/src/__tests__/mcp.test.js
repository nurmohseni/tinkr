const fs = require('fs')
const os = require('os')
const path = require('path')

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
    const mac = clients({platform: 'darwin', home: '/Users/dev'})
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
    ])
  })
})
