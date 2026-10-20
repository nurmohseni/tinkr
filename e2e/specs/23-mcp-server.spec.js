const path = require('path')
const {spawn} = require('child_process')
const {test, expect} = require('@playwright/test')

const {fixture, fixtureConnection, repo, seedProfile} = require('../support/tinkr')

/**
 * Start the server the way a client does: a node process, JSON-RPC on stdin and
 * stdout.
 */
const startServer = (args = ['--path', fixture, '--timeout', '20000']) => {
  const child = spawn(process.execPath, [
    path.join(repo, 'packages', 'tinkr-mcp', 'src', 'cli.js'),
    ...args,
  ], {
    cwd: repo,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const pending = new Map()
  const messages = []
  let buffer = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk

    let newline = buffer.indexOf('\n')

    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()

      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')

      if (line === '') {
        continue
      }

      const message = JSON.parse(line)

      messages.push(message)

      if (message.id !== undefined && pending.has(message.id)) {
        const {resolve, reject} = pending.get(message.id)

        pending.delete(message.id)

        if (message.error) {
          reject(new Error(message.error.message))
        } else {
          resolve(message.result)
        }
      }
    }
  })

  let next = 0

  const request = (method, params) => {
    const id = ++next

    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject})
      child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`)
    })
  }

  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method, params})}\n`)
  }

  return {
    child,
    request,
    notify,
    messages,
    stop: () => new Promise(resolve => {
      if (child.exitCode !== null) {
        resolve()

        return
      }

      child.once('exit', resolve)
      child.kill('SIGTERM')

      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL')
        }
      }, 3000).unref()
    }),
  }
}

test.describe('the MCP server', () => {
  test('answers the handshake, lists its tools and runs code in the fixture', async () => {
    const server = startServer()

    try {
      const init = await server.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {name: 'tinkr-e2e', version: '1'},
      })

      expect(init.serverInfo.name).toBe('tinkr-mcp')
      expect(init.protocolVersion).toBe('2025-06-18')

      server.notify('notifications/initialized')

      const tools = await server.request('tools/list', {})

      const names = tools.tools.map(tool => tool.name)

      expect(names).toEqual(expect.arrayContaining([
        'tinkr_run_php',
        'tinkr_run_php_over_ssh',
        'tinkr_list_connections',
        'tinkr_list_snippets',
        'tinkr_save_snippet',
        'tinkr_delete_snippet',
        'tinkr_list_history',
        'tinkr_read_run',
      ]))

      const answer = await server.request('tools/call', {
        name: 'tinkr_run_php',
        arguments: {code: '1 + 1;'},
      })

      expect(answer.isError).toBe(false)
      expect(answer.structuredContent.value).toBe(2)
      expect(answer.content[0].text).toBe('Line 1: 2')

      const guarded = await server.request('tools/call', {
        name: 'tinkr_run_php',
        arguments: {
          code: "DB::update('update orders set paid = 1 where id = 1');",
          guard: 'rollback',
        },
      })

      expect(guarded.isError).toBe(false)
      expect(guarded.structuredContent.transaction).toMatchObject({
        mode: 'rollback',
        armed: true,
        outcome: 'rolledBack',
        statements: 1,
      })
      expect(guarded.structuredContent.queriesTotal).toBe(1)
    } finally {
      await server.stop()
    }
  })

  test('saves, lists and deletes snippets in the app data it was pointed at', async () => {
    const profile = seedProfile({connections: [fixtureConnection()]})
    const dataDir = path.join(profile, 'Electron')
    const server = startServer([
      '--data-dir', dataDir,
      '--connection', 'fixture',
      '--timeout', '20000',
    ])

    try {
      await server.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {name: 'tinkr-e2e', version: '1'},
      })

      server.notify('notifications/initialized')

      const saved = await server.request('tools/call', {
        name: 'tinkr_save_snippet',
        arguments: {name: 'From MCP', code: '6 * 7;'},
      })

      expect(saved.isError).toBe(false)
      expect(saved.structuredContent.snippet.name).toBe('From MCP')
      expect(saved.structuredContent.snippet.code).toBe('6 * 7;')

      const listed = await server.request('tools/call', {
        name: 'tinkr_list_snippets',
        arguments: {},
      })

      expect(listed.structuredContent.snippets).toHaveLength(1)
      expect(listed.structuredContent.snippets[0]).toMatchObject({
        name: 'From MCP',
        code: '6 * 7;',
      })

      const removed = await server.request('tools/call', {
        name: 'tinkr_delete_snippet',
        arguments: {id: listed.structuredContent.snippets[0].id},
      })

      expect(removed.isError).toBe(false)

      const empty = await server.request('tools/call', {
        name: 'tinkr_list_snippets',
        arguments: {},
      })

      expect(empty.structuredContent.snippets).toEqual([])
    } finally {
      await server.stop()
      require('fs').rmSync(profile, {recursive: true, force: true})
    }
  })
})
