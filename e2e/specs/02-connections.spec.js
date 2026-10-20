const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {fixture, launchTinkr} = require('../support/tinkr')
const {chooseKind, openNewConnection} = require('../support/actions')

const appFile = (profile, name) => path.join(profile, 'Electron', 'app', name)

test.describe('the connection dialog', () => {
  test('offers the four kinds and shows only the fields of the chosen one', async () => {
    const {page, close} = await launchTinkr()

    try {
      await openNewConnection(page)

      const dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('New Connection')
      await expect(dialog.locator('#connection-name')).toHaveValue('New Connection')
      await expect(dialog.locator('#connection-path')).toBeVisible()
      await expect(dialog.locator('#connection-command')).toBeVisible()
      await expect(dialog.locator('#connection-tag')).toHaveValue('local')
      await expect(dialog.getByRole('button', {name: 'Connect'})).toBeVisible()

      // local
      await expect(dialog.locator('#connection-ssh-server')).toHaveCount(0)
      await expect(dialog.locator('#connection-container-name')).toHaveCount(0)

      // container: engine, container, project path, and no command of its own
      await chooseKind(page, 'container')
      await expect(dialog.locator('#connection-container-engine')).toBeVisible()
      await expect(dialog.locator('#connection-container-engine')).toHaveValue('docker')
      await expect(dialog.locator('#connection-container-name')).toBeVisible()
      await expect(dialog.locator('#connection-container-path')).toBeVisible()
      await expect(dialog.locator('#connection-command')).not.toBeVisible()
      await expect(dialog.locator('#connection-ssh-server')).toHaveCount(0)

      // ssh: the tunnel's fields, and no picker for a path on this machine
      await chooseKind(page, 'ssh')
      await expect(dialog.locator('#connection-ssh-server')).toBeVisible()
      await expect(dialog.locator('#connection-ssh-port')).toBeVisible()
      await expect(dialog.locator('#connection-ssh-user')).toBeVisible()
      await expect(dialog.locator('#connection-ssh-password')).toBeVisible()
      await expect(dialog.getByRole('button', {name: 'Select directory...'})).toHaveCount(0)
      await expect(dialog.locator('#connection-container-name')).toHaveCount(0)

      // ssh + container: both halves at once
      await chooseKind(page, 'ssh + container')
      await expect(dialog.locator('#connection-ssh-server')).toBeVisible()
      await expect(dialog.locator('#connection-container-engine')).toBeVisible()
      await expect(dialog.locator('#connection-container-name')).toBeVisible()
      await expect(dialog.locator('#connection-command')).not.toBeVisible()
    } finally {
      await close()
    }
  })

  test('closes a draft without writing it anywhere', async () => {
    const {page, profile, close} = await launchTinkr()

    try {
      await openNewConnection(page)
      await page.getByRole('dialog').locator('#connection-name').fill('Not saved')
      await page.keyboard.press('Escape')

      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('1')

      const stored = JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8'))

      expect(stored.fixture).toBeDefined()
      expect(JSON.stringify(stored)).not.toContain('Not saved')
    } finally {
      await close()
    }
  })

  test('creates a connection on Connect, switches the window to it and keeps it', async () => {
    const {page, profile, close} = await launchTinkr()

    try {
      await openNewConnection(page)

      const dialog = page.getByRole('dialog')

      await dialog.locator('#connection-name').fill('Second')
      await dialog.locator('#connection-path').fill(fixture)
      await dialog.locator('#connection-command').fill('php artisan tinker')
      await dialog.locator('#connection-tag').selectOption('testing')
      await dialog.getByRole('button', {name: 'Connect'}).click()

      await expect(page.locator('.statusbar')).toContainText('Connected · Second (local)')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('2')
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('Second')
      await expect(page.locator('.titlebar__center')).toContainText('Second')

      const stored = JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8'))
      const second = Object.values(stored).find(connection => connection.name === 'Second')

      expect(second).toMatchObject({
        name: 'Second',
        path: fixture,
        command: 'php artisan tinker',
        tag: 'testing',
        is_over_ssh: false,
      })
      expect(second.password).toBeUndefined()
      expect(second.ssh_password).toBe(false)

      await page.locator('.statusbar').getByText(/PHP \d/).waitFor({timeout: 15_000})
    } finally {
      await close()
    }
  })

  test('autosaves an edited connection and shows its tag in the sidebar', async () => {
    const {page, profile, close} = await launchTinkr()

    try {
      // clicking the row of the connection the window is on opens its settings
      await page.getByRole('navigation', {name: 'Connections'}).getByRole('button', {name: /^Fixture/}).click()
      await expect(page.getByRole('dialog')).toBeVisible()

      const dialog = page.getByRole('dialog')

      await dialog.locator('#connection-name').fill('Renamed')
      // the form writes back after a pause
      await page.waitForTimeout(900)
      await dialog.locator('#connection-tag').selectOption('production')
      await page.waitForTimeout(900)

      const stored = JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8'))

      expect(stored.fixture.name).toBe('Renamed')
      expect(stored.fixture.tag).toBe('production')

      await page.keyboard.press('Escape')
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('Renamed')
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('production')
    } finally {
      await close()
    }
  })

  test('answers a clone event from the main process with a new draft', async () => {
    const {app, page, close} = await launchTinkr()

    try {
      await app.evaluate(({BrowserWindow}) => {
        const win = BrowserWindow.getAllWindows()[0]

        win.webContents.send('cloneConnection', {
          id: 'fixture',
          name: 'Fixture',
          path: process.cwd(),
          command: 'php artisan tinker',
          is_over_ssh: false,
          tag: 'local',
        })
      })

      const dialog = page.getByRole('dialog')

      await expect(dialog).toBeVisible()
      await expect(dialog.locator('#connection-name')).toHaveValue('Fixture')
      // a copy is a new connection with an id of its own; the app stores it and
      // opens its dialog, so both the store and the sidebar have it
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('2')
    } finally {
      await close()
    }
  })

  test('asks before deleting a connection, and deletes it', async () => {
    const {app, page, profile, close} = await launchTinkr({
      connections: [
        // the first one the window opens on
        {
          id: 'fixture',
          name: 'Fixture',
          path: fixture,
          command: 'php artisan tinker',
          is_over_ssh: false,
          tag: 'local',
        },
        {
          id: 'spare',
          name: 'Spare',
          path: fixture,
          command: 'php artisan tinker',
          is_over_ssh: false,
          tag: 'local',
        },
      ],
    })

    try {
      await app.evaluate(({BrowserWindow}) => {
        BrowserWindow.getAllWindows()[0].webContents.send('deleteConnectionConfirm', {
          id: 'spare',
          name: 'Spare',
          path: process.cwd(),
          command: 'php artisan tinker',
          is_over_ssh: false,
          tag: 'local',
        })
      })

      const dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('Are you absolutely sure?')
      await expect(dialog).toContainText('Spare')

      await dialog.getByRole('button', {name: 'Cancel'}).click()
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('2')

      await app.evaluate(({BrowserWindow}) => {
        BrowserWindow.getAllWindows()[0].webContents.send('deleteConnectionConfirm', {
          id: 'spare',
          name: 'Spare',
          path: process.cwd(),
          command: 'php artisan tinker',
          is_over_ssh: false,
          tag: 'local',
        })
      })

      await page.getByRole('dialog').getByRole('button', {name: 'Delete Connection'}).click()

      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('1')
      await expect(page.getByRole('navigation', {name: 'Connections'})).not.toContainText('Spare')

      const stored = JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8'))

      expect(stored.spare).toBeUndefined()
      expect(stored.fixture).toBeDefined()

      // the deleted connection is also the one the status bar was on
      await expect(page.locator('.statusbar')).not.toContainText('Spare')
    } finally {
      await close()
    }
  })
})
