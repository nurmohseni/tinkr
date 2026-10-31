const fs = require('fs')
const path = require('path')
const {spawn} = require('child_process')
const {test, expect} = require('@playwright/test')

const {fixtureConnection, launchTinkr, repo, seedProfile} = require('../support/tinkr')
const {runCode} = require('../support/actions')

const configFile = profile => path.join(profile, 'Electron', 'app', 'config.json')
const historyFile = profile => path.join(profile, 'Electron', 'app', 'history', 'fixture.json')

/**
 * Start the server the way a client does: a node process, JSON-RPC on stdin and
 * stdout.
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

const handshake = async server => {
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {name: 'tinkr-redaction', version: '1'},
  })
}

test.describe('hidden fields', () => {
  test('the pane shows a value the history and MCP answers hold as [hidden]', async () => {
    const {app, page, profile, close} = await launchTinkr()

    try {
      await runCode(page, 'User::first();')

      // what the person ran is on the screen in full: they are the one reader
      // who did run it
      await expect(page.locator('.output')).toContainText('hunter2-fixture')
      await expect(page.locator('.output')).toContainText('Zx9-fixture-token')

      // what was written down is not
      await expect.poll(() => {
        try {
          return JSON.parse(fs.readFileSync(historyFile(profile), 'utf8')).entries[0].value
        } catch (e) {
          return null
        }
      }).toEqual({
        id: 1,
        name: 'Ada',
        email: 'ada@example.test',
        password: '[hidden]',
        remember_token: '[hidden]',
        api_key: '[hidden]',
      })

      const entry = JSON.parse(fs.readFileSync(historyFile(profile), 'utf8')).entries[0]
      const dataDir = path.join(profile, 'Electron')
      const server = startServer(['--data-dir', dataDir, '--connection', 'fixture', '--timeout', '20000'])

      try {
        await handshake(server)

        const read = await server.request('tools/call', {name: 'tinkr_read_run', arguments: {id: entry.id}})

        expect(read.isError).toBe(false)
        expect(read.structuredContent.value.password).toBe('[hidden]')
        expect(read.structuredContent.value.remember_token).toBe('[hidden]')
        expect(read.content[0].text).toContain('"password": "[hidden]"')
        expect(read.content[0].text).not.toContain('hunter2-fixture')

        const ran = await server.request('tools/call', {name: 'tinkr_run_php', arguments: {code: 'User::first();'}})

        expect(ran.isError).toBe(false)
        expect(ran.structuredContent.value.password).toBe('[hidden]')
        expect(ran.structuredContent.value.api_key).toBe('[hidden]')
        expect(ran.content[0].text).not.toContain('hunter2-fixture')
        expect(ran.content[0].text).toContain('"password": "[hidden]"')

        // the list is the app's, and it is read on every call: a field that is
        // no longer on it is answered the next time, in the same server
        const [settings] = await Promise.all([
          app.waitForEvent('window'),
          page.getByRole('button', {name: 'Settings'}).click(),
        ])

        await settings.locator('.app').waitFor({state: 'visible'})
        await settings.locator('aside.rail').getByRole('button', {name: 'General'}).click()

        const fields = settings.getByLabel('Hidden fields')

        await expect(fields).toHaveValue('*password*\n*token*\n*secret*\napi_key\n*_key\n*authorization*\ncookie')
        await fields.fill('nickname')

        await expect.poll(() => JSON.parse(fs.readFileSync(configFile(profile), 'utf8')).redact_fields)
          .toEqual(['nickname'])

        const again = await server.request('tools/call', {name: 'tinkr_run_php', arguments: {code: 'User::first();'}})

        expect(again.structuredContent.value.password).toBe('hunter2-fixture')
        expect(again.structuredContent.value.api_key).toBe('sk-fixture-key')
        expect(again.content[0].text).toContain('hunter2-fixture')
      } finally {
        await server.stop()
      }
    } finally {
      await close()
    }
  })

  test('an empty list hides nothing', async () => {
    const profile = seedProfile({
      connections: [fixtureConnection()],
      config: {redact_fields: []},
    })
    const {page, close} = await launchTinkr({}, {profile, keepProfile: true})

    try {
      await runCode(page, 'User::first();')

      await expect.poll(() => {
        try {
          return JSON.parse(fs.readFileSync(historyFile(profile), 'utf8')).entries[0].value
        } catch (e) {
          return null
        }
      }).toEqual({
        id: 1,
        name: 'Ada',
        email: 'ada@example.test',
        password: 'hunter2-fixture',
        remember_token: 'Zx9-fixture-token',
        api_key: 'sk-fixture-key',
      })
    } finally {
      await close()
      fs.rmSync(profile, {recursive: true, force: true})
    }
  })
})