const fs = require('fs')
const path = require('path')
const {spawn} = require('child_process')
const {test, expect} = require('@playwright/test')

const {copyFixture, fixtureConnection, launchTinkr, repo} = require('../support/tinkr')

const appFile = (profile, name) => path.join(profile, 'Electron', 'app', name)
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

/**
 * Start the server the way a client does: a node process, JSON-RPC on stdin and
 * stdout. The same shape spec 23 uses, because both drive the real server.
 */
const startServer = args => {
  const child = spawn(process.execPath, [
    path.join(repo, 'packages', 'tinkr-mcp', 'src', 'cli.js'),
    ...args,
  ], {
    cwd: repo,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const pending = new Map()
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

  return {
    request,
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

test.describe('MCP production access', () => {
  test('refuses by default, runs a write in a forced sandbox, and follows a connection override', async () => {
    // a copy of the project whose database is a file shared by every session:
    // that is what makes "the row is unchanged afterwards" a thing the test can
    // see, rather than only the transaction's own report
    const project = copyFixture()

    fs.writeFileSync(path.join(project, 'storage', 'fixture-db'), '')

    const {app, page, profile, close} = await launchTinkr({
      connections: [fixtureConnection({path: project, tag: 'production'})],
    })
    const server = startServer([
      '--data-dir', path.join(profile, 'Electron'),
      '--connection', 'fixture',
      '--timeout', '20000',
    ])
    const call = (name, args) => server.request('tools/call', {name, arguments: args})
    const sql = code => call('tinkr_run_php', {code})

    try {
      await server.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {name: 'tinkr-e2e', version: '7'},
      })

      // the default: nothing runs on a production connection, and the answer
      // says which setting refused it
      const refused = await sql('1 + 1;')

      expect(refused.isError).toBe(true)
      expect(refused.content[0].text).toContain('Settings → MCP')
      expect(refused.content[0].text).toContain('refuse')
      expect(refused.content[0].text).toContain('Production connections')

      const [settings] = await Promise.all([
        app.waitForEvent('window'),
        page.getByRole('button', {name: 'Settings'}).click(),
      ])

      await settings.locator('.app').waitFor({state: 'visible'})
      await settings.locator('aside.rail').getByRole('button', {name: 'MCP'}).click()

      // guarded: the next run of the same server goes through, with the guard
      // the app forced on it
      await settings.locator('.segmented__item').filter({hasText: 'Sandbox'}).click()

      await expect.poll(() => readJson(appFile(profile, 'config.json')).mcp_production).toBe('guarded')

      const write = await sql("DB::update('update orders set paid = 1 where id = 2');")

      expect(write.isError).toBe(false)
      expect(write.content[0].text).toContain('Guarded run: Fixture is tagged production')
      expect(write.content[0].text).toContain('forced to `guard: "sandbox"`')
      expect(write.content[0].text).toContain('Settings → MCP')
      expect(write.structuredContent.production).toEqual({
        mode: 'guarded',
        source: 'settings',
        guard_forced: true,
      })
      expect(write.structuredContent.transaction).toMatchObject({
        armed: true,
        outcome: 'rolledBack',
        statements: 1,
      })

      // the database the fixture shares between sessions: the update was taken
      // back, not only reported as taken back
      const afterRollback = await sql("DB::select('select paid from orders where id = 2');")

      expect(afterRollback.isError).toBe(false)
      expect(afterRollback.structuredContent.value).toEqual([{paid: 0}])

      // the connection's own access overrides the setting, and is written the
      // way the app writes a connection
      await settings.getByLabel('Access for Fixture').selectOption('allow')

      await expect.poll(() => readJson(appFile(profile, 'connections.json')).fixture.mcp_access).toBe('allow')

      const kept = await sql("DB::update('update orders set paid = 1 where id = 2');")

      expect(kept.isError).toBe(false)
      expect(kept.content[0].text).not.toContain('Guarded run')
      expect(kept.structuredContent.production).toEqual({
        mode: 'allow',
        source: 'connection',
        guard_forced: false,
      })

      // an allowed write is a write: the next session reads the value back
      const afterCommit = await sql("DB::select('select paid from orders where id = 2');")

      expect(afterCommit.structuredContent.value).toEqual([{paid: 1}])

      // the sessions list says the guard was forced, distinctly from a guard
      // the call asked for
      const session = settings.locator('.mcpsession').filter({hasText: 'tinkr-e2e'})

      await expect(session).toContainText('5 calls', {timeout: 10_000})
      await session.locator('.mcpsession__row').click()

      const updates = session.locator('.mcpcall').filter({hasText: 'update orders set paid = 1'})

      await expect(updates).toHaveCount(2)

      // newest first: the allowed write, then the one the settings forced
      const forced = updates.nth(1)

      await forced.locator('summary').click()
      await expect(forced).toContainText('Guard: sandbox, forced by Settings')
      await expect(forced.locator('.mcpcall__meta--forced')).toBeVisible()

      const asked = updates.nth(0)

      await asked.locator('summary').click()
      await expect(asked).not.toContainText('forced by')
    } finally {
      await server.stop()
      await close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })
})
