const fs = require('fs')
const path = require('path')
const {spawn} = require('child_process')
const {test, expect} = require('@playwright/test')

const {copyFixture, fixture, fixtureConnection, launchTinkr, repo} = require('../support/tinkr')

const historyFile = (profile, id) => path.join(profile, 'Electron', 'app', 'history', `${id}.json`)

/**
 * Start the server the way a client does: a node process, JSON-RPC on stdin and
 * stdout (the shape 23-mcp-server uses).
 */
const startServer = (args = ['--timeout', '20000']) => {
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

test.describe('an MCP call opened from the settings', () => {
  test('switches the editor to the call\'s connection and opens its code, without running it', async () => {
    // the second connection runs in a copy of the fixture, so nothing here is
    // ever run and its history file is what says so
    const secondDir = copyFixture()
    const {app, page, profile, close} = await launchTinkr({
      connections: [
        fixtureConnection(),
        fixtureConnection({id: 'second', name: 'Second', path: secondDir, tag: 'testing'}),
        fixtureConnection({id: 'gone', name: 'Gone', path: fixture, tag: 'local'}),
      ],
    })
    const server = startServer([
      '--data-dir', path.join(profile, 'Electron'),
      '--connection', 'fixture',
      '--timeout', '20000',
    ])

    try {
      await server.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {name: 'tinkr-e2e', version: '1'},
      })

      // a run on the window's own connection, so the window has to switch
      const ran = await server.request('tools/call', {
        name: 'tinkr_run_php',
        arguments: {connection: 'second', code: '6 * 7;'},
      })

      expect(ran.isError).toBe(false)
      expect(ran.structuredContent.value).toBe(42)

      // and one in a connection that is about to be deleted
      const doomed = await server.request('tools/call', {
        name: 'tinkr_run_php',
        arguments: {connection: 'gone', code: '3 + 3;'},
      })

      expect(doomed.isError).toBe(false)
      expect(doomed.structuredContent.value).toBe(6)

      const [settings] = await Promise.all([
        app.waitForEvent('window'),
        page.getByRole('button', {name: 'Settings'}).click(),
      ])

      await settings.locator('.app').waitFor({state: 'visible'})
      await settings.locator('aside.rail').getByRole('button', {name: 'MCP'}).click()

      const session = settings.locator('.mcpsession').filter({hasText: 'tinkr-e2e'})

      await expect(session).toContainText('2 calls', {timeout: 10_000})

      await session.locator('.mcpsession__row').click()

      const calls = session.locator('.mcpcall')

      await expect(calls).toHaveCount(2)

      // delete the connection the older call ran in, the way a person does: the
      // confirmation is raised in the editor window, which is the one that is
      // looked up by what it runs rather than by its place in the list
      await app.evaluate(({BrowserWindow}) => {
        const win = BrowserWindow.getAllWindows()
          .find(one => one.webContents.getURL().includes('editor.html'))

        win.webContents.send('deleteConnectionConfirm', {
          id: 'gone',
          name: 'Gone',
          path: process.cwd(),
          command: 'php artisan tinker',
          is_over_ssh: false,
          tag: 'local',
        })
      })

      await page.getByRole('dialog').getByRole('button', {name: 'Delete Connection'}).click()
      await expect(page.getByRole('navigation', {name: 'Connections'})).not.toContainText('Gone')

      // calls are newest first: the deleted connection's call, then the one on
      // the second connection
      const deleted = calls.nth(0)
      const kept = calls.nth(1)

      await expect(deleted).toContainText('tinkr_run_php')
      await expect(kept).toContainText('6 * 7;')

      // once the screen has read the connections again, the deleted call has no
      // button and says why, and the kept one still has its button
      await expect(deleted).toContainText('Gone is no longer saved', {timeout: 10_000})
      await expect(deleted.getByRole('button', {name: 'Open in editor'})).toHaveCount(0)

      // the call's detail is drawn when it is opened; the button is in it
      await kept.locator('summary').click()

      await expect(kept.getByRole('button', {name: 'Open in editor'})).toBeVisible()

      // the editor window is still on the first connection until the press
      await expect(page.locator('.statusbar')).toContainText('Connected · Fixture')

      await kept.getByRole('button', {name: 'Open in editor'}).click()

      // the window was switched exactly as picking the connection would switch
      // it (the raise itself has no headless window manager to answer to; the
      // unit test holds `focus()`)
      await expect(page.locator('.statusbar')).toContainText('Connected · Second')

      // a new tab holds exactly that code, named for the tool and the time
      const tabs = page.getByRole('tablist', {name: 'Open documents'})

      await expect(tabs.getByRole('tab', {name: /tinkr_run_php/})).toBeVisible()
      await expect(page.getByRole('tab', {name: /tinkr_run_php/})).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.editor .monaco-editor').first()).toContainText('6 * 7;')

      // nothing ran: no history entry, and the output pane holds no answer
      expect(fs.existsSync(historyFile(profile, 'second'))).toBe(false)
      await expect(page.locator('.output .result-summary')).toHaveCount(0)

      // and the same code is in the tab, not the newer call's
      await expect(page.locator('.editor .monaco-editor').first()).not.toContainText('3 + 3;')
    } finally {
      await server.stop()
      await close()
      fs.rmSync(secondDir, {recursive: true, force: true})
    }
  })
})
