const fs = require('fs')
const path = require('path')
const {spawn} = require('child_process')
const {test, expect} = require('@playwright/test')

const {fixture, fixtureConnection, launchTinkr, repo, seedProfile} = require('../support/tinkr')

const configFile = profile => path.join(profile, 'Electron', 'app', 'config.json')

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
    // app data of its own: the server keeps its session there, and the
    // person's own Tinkr is not where a test leaves one
    const profile = seedProfile({connections: []})
    const server = startServer(['--path', fixture, '--data-dir', path.join(profile, 'Electron'), '--timeout', '20000'])

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
        'tinkr_list_logs',
        'tinkr_tail_logs',
      ]))

      const answer = await server.request('tools/call', {
        name: 'tinkr_run_php',
        arguments: {code: '1 + 1;'},
      })

      expect(answer.isError).toBe(false)
      expect(answer.structuredContent.value).toBe(2)

      // the first line is the statement's answer, and what the snippet spent is
      // the run's own measurement: the line is there, its numbers are not pinned
      const [valueLine, ...spent] = answer.content[0].text.split('\n')

      expect(valueLine).toBe('Line 1: 2')
      expect(spent.join('\n')).toMatch(/^spent \d+ ms in PHP, peaking at [\d.]+ (B|KB|MB)$/)

      // the project's own logs, read the way the viewer reads them and scanned
      // the way an agent looking for something does
      const files = await server.request('tools/call', {
        name: 'tinkr_list_logs',
        arguments: {},
      })

      expect(files.isError).toBe(false)
      expect(files.structuredContent.files.map(one => one.name))
        .toEqual(expect.arrayContaining(['laravel.log', 'worker.log']))

      const errors = await server.request('tools/call', {
        name: 'tinkr_tail_logs',
        arguments: {file: 'laravel.log', level: 'error'},
      })

      expect(errors.isError).toBe(false)
      expect(errors.structuredContent.filtered).toBe(true)
      expect(errors.structuredContent.entries.map(one => one.message)).toEqual(['fixture failure'])
      expect(errors.structuredContent.entries[0].details).toContain('RuntimeException: boom')

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
      fs.rmSync(profile, {recursive: true, force: true})
    }
  })

  test('runs on production through the production mode, and lists the session there', async () => {
    const {app, page, profile, close} = await launchTinkr({
      connections: [fixtureConnection({tag: 'production'})],
    })
    // started on the production connection by name, which used to be enough
    const server = startServer([
      '--data-dir', path.join(profile, 'Electron'),
      '--connection', 'fixture',
      '--timeout', '20000',
    ])

    try {
      await server.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {name: 'tinkr-e2e', version: '7'},
      })

      const refused = await server.request('tools/call', {name: 'tinkr_run_php', arguments: {code: '1 + 1;'}})

      expect(refused.isError).toBe(true)
      expect(refused.content[0].text).toContain('Settings → MCP')
      expect(refused.content[0].text).toContain('refuse')

      const [settings] = await Promise.all([
        app.waitForEvent('window'),
        page.getByRole('button', {name: 'Settings'}).click(),
      ])

      await settings.locator('.app').waitFor({state: 'visible'})
      await settings.locator('aside.rail').getByRole('button', {name: 'MCP'}).click()
      await settings.locator('.segmented__item').filter({hasText: 'Sandbox'}).click()

      await expect.poll(() => JSON.parse(fs.readFileSync(configFile(profile), 'utf8')).mcp_production).toBe('guarded')

      // the same server, still running, follows the setting, and the run goes
      // out with the guard the mode forced on it
      const ran = await server.request('tools/call', {name: 'tinkr_run_php', arguments: {code: '1 + 1;'}})

      expect(ran.isError).toBe(false)
      expect(ran.structuredContent.value).toBe(2)
      expect(ran.content[0].text).toContain('forced to `guard: "sandbox"`')

      // the list is read again while it is open, so the calls show up there
      const session = settings.locator('.mcpsession').filter({hasText: 'tinkr-e2e'})

      await expect(session).toContainText('2 calls', {timeout: 10_000})
      await expect(session).toContainText('1 threw')
      await expect(session).toContainText('Live')

      await session.locator('.mcpsession__row').click()

      const calls = session.locator('.mcpcall')

      await expect(calls).toHaveCount(2)
      // newest first: the run that went through, then the one that was refused
      await expect(calls.nth(0)).toContainText('tinkr_run_php')
      await expect(calls.nth(1)).toContainText('production')

      await calls.nth(1).locator('summary').click()
      await expect(calls.nth(1)).toContainText('refuse')

      // a client that closes the pipe ends its session
      await server.stop()
      await expect(session).not.toContainText('Live', {timeout: 10_000})

      // an ended session can be forgotten, once asked
      await settings.locator('.mcppane').filter({has: settings.locator('.mcppane__head', {hasText: 'Sessions'})})
        .getByRole('button', {name: 'Clear'})
        .click()
      await settings.getByRole('dialog', {name: 'Forget the ended sessions?'}).getByRole('button', {name: 'Clear'}).click()
      await expect(settings.getByText('No client has used the server yet')).toBeVisible()
      expect(fs.readdirSync(path.join(profile, 'Electron', 'app', 'mcp'))).toEqual([])
    } finally {
      await server.stop()
      await close()
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
