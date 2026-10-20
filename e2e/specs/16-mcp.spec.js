const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')

const configFile = profile => path.join(profile, 'Electron', 'app', 'config.json')

const openSettings = async (app, page) => {
  const [settings] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', {name: 'Settings'}).click(),
  ])

  await settings.locator('.app').waitFor({state: 'visible'})
  await expect(settings.locator('aside.rail')).toBeVisible()

  return settings
}

test.describe('the MCP section', () => {
  test('names the bundled server, configures a client, and lists its tools', async () => {
    const {app, page, profile, close} = await launchTinkr({
      // the account's home is the test's own, and a Cursor data directory there
      // is what the app reads as "installed": nothing of the person's own
      // configuration is read or written
      home: true,
      dirs: ['home/.cursor'],
    })

    try {
      const settings = await openSettings(app, page)

      await settings.locator('aside.rail').getByRole('button', {name: 'MCP'}).click()

      // which connection a client's calls run in
      await settings.getByLabel('Run in').selectOption('fixture')

      await expect.poll(() => JSON.parse(fs.readFileSync(configFile(profile), 'utf8')).mcp_connection)
        .toBe('fixture')

      const entry = settings.locator('.mcppane').first()

      await expect(entry).toContainText('Any other client')
      await expect(entry.locator('.mcppane__body')).toContainText('"mcpServers"')
      await expect(entry.locator('.mcppane__body')).toContainText('tinkr-mcp')
      await expect(entry.locator('.mcppane__body')).toContainText('--connection')
      await expect(entry.locator('.mcppane__body')).toContainText('fixture')

      // a client that keeps a file gets that file written, and only its entry
      const cursor = settings.locator('.setting').filter({hasText: 'Cursor'})

      await expect(cursor).toContainText('installed')
      await cursor.getByRole('button', {name: 'Configure'}).click()

      await expect(cursor).toContainText('written — restart Cursor')

      const written = JSON.parse(fs.readFileSync(path.join(profile, 'home', '.cursor', 'mcp.json'), 'utf8'))

      expect(written.mcpServers.tinkr.command).toBe('node')
      expect(written.mcpServers.tinkr.args.join(' ')).toContain('tinkr-mcp')
      expect(written.mcpServers.tinkr.args).toContain('--connection')
      expect(written.mcpServers.tinkr.args).toContain('fixture')

      // the tools the server offers, in the app's own words
      const tools = settings.locator('.mcppane').last()

      await expect(tools).toContainText('Tools')
      await expect(tools).toContainText('tinkr_run_php')
      await expect(tools).toContainText('tinkr_save_snippet')

      // Claude Code is configured with its own command, and Copy puts it on the
      // clipboard the app can read
      const claude = settings.locator('.setting').filter({hasText: 'Claude Code'})

      await claude.getByRole('button', {name: 'Copy'}).click()

      const copied = await app.evaluate(({clipboard}) => clipboard.readText())

      expect(copied).toContain('claude mcp add')
      expect(copied).toContain('tinkr-mcp')
      expect(copied).toContain('--connection fixture')
    } finally {
      await close()
    }
  })
})
