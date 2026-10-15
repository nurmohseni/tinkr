import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'
import {createStore} from 'jotai/vanilla'

global.React = React

// the connections the select lists, without the store that reads them: it
// reaches into the editor, the history and the sessions the window has open
jest.mock('../../../stores/connections', () => ({
  connectionListAtom: require('jotai').atom([
    {id: 'one', name: 'The App'},
    {id: 'production', name: 'Production'},
  ]),
}))

// the main process is what knows the server's path and the client files, and a
// test is not the machine: one answer stands in for all of it
jest.mock('../../../utils/api', () => {
  const server = '/app/main/mcp-server.js'
  const info = {
    server,
    connection: '',
    entry: {command: 'node', args: [server]},
    command: `claude mcp add --scope user tinkr -- node "${server}"`,
    config: {mcpServers: {tinkr: {command: 'node', args: [server]}}},
    tools: ['tinkr_run_php', 'tinkr_run_php_over_ssh'],
    clients: [
      {
        id: 'claude-code',
        name: 'Claude Code',
        kind: 'command',
        key: 'mcpServers',
        file: null,
        installed: true,
        configured: false,
      },
      {
        id: 'cursor',
        name: 'Cursor',
        kind: 'file',
        key: 'mcpServers',
        file: '/home/dev/.cursor/mcp.json',
        installed: true,
        configured: true,
      },
    ],
  }

  return {
    info,
    allConfig: () => ({mcp_connection: ''}),
    setConfig: jest.fn(),
    mcpInfo: jest.fn(() => info),
    configureMcp: jest.fn(),
  }
})

const api = require('../../../utils/api')
const english = require('../../../../../tinkr-main/src/lang/en.json')
const {mcpAtom, configureClientAtom} = require('../../../stores/mcp')
const McpForm = require('../McpForm').default

const render = () => renderToStaticMarkup(
  <IntlProvider
    locale='en'
    messages={flatten(english)}
  >
    <McpForm/>
  </IntlProvider>,
)

describe('the MCP settings', () => {
  test('offers the connections the app has, and the client\'s own project as well', () => {
    const markup = render()

    expect(markup).toContain('Run in')
    expect(markup).toContain('The client&#x27;s own project')
    expect(markup).toContain('The App')
    expect(markup).toContain('Production')
  })

  test('shows each client the file it would be given, and where it stands', () => {
    const markup = render()

    expect(markup).toContain('Cursor')
    expect(markup).toContain('/home/dev/.cursor/mcp.json')
    expect(markup).toContain('Configured')
    expect(markup).toContain('Configure')

    // Claude Code is given the command that writes its own configuration
    expect(markup).toContain('Claude Code')
    expect(markup).toContain('claude mcp add --scope user tinkr -- node &quot;/app/main/mcp-server.js&quot;')
    expect(markup).toContain('Copy')
  })

  test('hands over the entry itself, with the server it runs', () => {
    const markup = render()

    expect(markup).toContain('Any other client')
    expect(markup).toContain('under `mcpServers` in the client&#x27;s own configuration')
    expect(markup).toContain('&quot;mcpServers&quot;')
    expect(markup).toContain('&quot;command&quot;: &quot;node&quot;')
    expect(markup).toContain('/app/main/mcp-server.js')
  })

  test('lists what the server offers, in the app\'s words', () => {
    const markup = render()

    expect(markup).toContain('Tools')
    expect(markup).toContain('tinkr_run_php')
    expect(markup).toContain('runs PHP in a project on this machine')
    expect(markup).toContain('tinkr_run_php_over_ssh')
    expect(markup).toContain('runs PHP on a server, over ssh')
  })
})

describe('pointing a client at the server', () => {
  test('writes it, and takes the answer the write produced', async () => {
    const store = createStore()
    const written = {...api.info, clients: api.info.clients.map(one => ({...one, configured: true}))}

    api.configureMcp.mockResolvedValue({file: '/home/dev/.cursor/mcp.json', info: written})

    await store.set(configureClientAtom, 'cursor')

    expect(api.configureMcp).toHaveBeenCalledWith('cursor')
    expect(store.get(mcpAtom)).toBe(written)
  })
})
