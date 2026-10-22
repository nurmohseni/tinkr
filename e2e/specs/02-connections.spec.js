const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {fixture, fixtureConnection, launchTinkr} = require('../support/tinkr')
const {chooseKind, editConnection, openConnection, openNewConnection, setEditorCode} = require('../support/actions')

const appFile = (profile, name) => path.join(profile, 'Electron', 'app', name)

test.describe('the connection dialog', () => {
  test('offers the four kinds and shows only the fields of the chosen one', async () => {
    const {page, close} = await launchTinkr()

    try {
      await openNewConnection(page)

      const dialog = page.getByRole('dialog')

      await expect(dialog.locator('#connection-name')).toHaveValue('New Connection')
      await expect(dialog.locator('#connection-path')).toBeVisible()
      await expect(dialog.locator('#connection-command')).toBeVisible()
      await expect(dialog.getByRole('radio', {name: 'local', exact: true})).toBeChecked()
      await expect(dialog.getByRole('button', {name: 'Connect'})).toBeVisible()

      // the route says what Connect will start: a command left empty is the
      // default command from the settings
      await expect(dialog.getByRole('list', {name: 'Route'})).toContainText('php artisan tinker')

      // local
      await expect(dialog.locator('#connection-ssh-server')).toHaveCount(0)
      await expect(dialog.locator('#connection-container-name')).toHaveCount(0)

      // container: engine, container, project path, and no command of its own
      await chooseKind(page, 'container')
      await expect(dialog.getByRole('radiogroup', {name: 'Engine'})).toBeVisible()
      await expect(dialog.getByRole('radio', {name: 'docker', exact: true})).toBeChecked()
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
      await chooseKind(page, 'ssh-container')
      await expect(dialog.locator('#connection-ssh-server')).toBeVisible()
      await expect(dialog.getByRole('radiogroup', {name: 'Engine'})).toBeVisible()
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
      await dialog.getByRole('radiogroup', {name: 'Tag'}).getByText('testing', {exact: true}).click()
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


  test('keeps the tabs and the run of a connection the window moves away from', async () => {
    const {page, close} = await launchTinkr({
      connections: [
        fixtureConnection({id: 'one', name: 'One'}),
        fixtureConnection({id: 'two', name: 'Two'}),
      ],
    })

    try {
      const tabs = page.getByRole('tablist', {name: 'Open documents'}).getByRole('tab')
      const button = page.locator('.tabbar .btn--run').first()
      const output = page.locator('.output')
      const history = page.getByRole('navigation', {name: 'History'})

      await expect(page.locator('.statusbar')).toContainText('Connected · One')

      // a tab of its own holding code nobody saved, and a run that is still
      // going when the window moves: both belong to this connection
      await setEditorCode(page, 'sleep(4) + 42;')
      await page.locator('.tabbar__new').click()
      await setEditorCode(page, "'kept';")
      await expect(tabs).toHaveCount(2)

      await tabs.nth(0).click()
      await button.click()
      await expect(button).toHaveClass(/btn--danger/)

      await openConnection(page, 'Two')

      // the connection it moved to opens on its own session, with nothing of One
      await expect(tabs).toHaveCount(1)
      await expect(button).not.toHaveClass(/btn--danger/)

      // long enough for the run of One to come back with nobody watching it
      await page.waitForTimeout(6000)

      await openConnection(page, 'One')

      // the tabs came back, the run was not stopped by the move, and its answer
      // is on the tab that sent it
      await expect(tabs).toHaveCount(2)

      await tabs.nth(0).click()
      await expect(output.locator('.t-number').first()).toHaveText('42', {timeout: 60_000})
      await expect(button).not.toHaveClass(/btn--danger/)

      // the run happened while the window was elsewhere, and the history says so
      await expect(history.locator('.tree-nav__row--run')).toHaveCount(1)

      // and the other tab is the code it held, not an empty one
      await tabs.nth(1).click()
      await expect(page.locator('.editor .monaco-editor').first()).toContainText("'kept';")
    } finally {
      await close()
    }
  })

  test('leaves a run going while the window is on another connection', async () => {
    const {page, close} = await launchTinkr({
      connections: [
        fixtureConnection({id: 'one', name: 'One'}),
        fixtureConnection({id: 'two', name: 'Two'}),
      ],
    })

    try {
      const button = page.locator('.tabbar .btn--run').first()
      const output = page.locator('.output')

      await expect(page.locator('.statusbar')).toContainText('Connected · One')

      // long enough that the run is still going when the window is back on One
      await setEditorCode(page, 'sleep(6) + 42;')
      await button.click()
      await expect(button).toHaveClass(/btn--danger/)

      await openConnection(page, 'Two')
      await openConnection(page, 'One')

      // the session the window left was not stopped by the move: it is still the
      // run that is going, and it answers on the tab that sent it
      await expect(button).toHaveClass(/btn--danger/)
      await expect(output.locator('.t-number').first()).toHaveText('42', {timeout: 60_000})
    } finally {
      await close()
    }
  })

  test('keeps an edit only when Save is pressed, and shows its tag in the sidebar', async () => {
    const {page, profile, close} = await launchTinkr()
    const read = () => JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8')).fixture

    try {
      // a row only connects; the pencil on it is what opens its settings
      await editConnection(page, 'Fixture')

      let dialog = page.getByRole('dialog')
      const save = dialog.getByRole('button', {name: 'Save', exact: true})

      // nothing to save until something changed
      await expect(save).toBeDisabled()

      await dialog.locator('#connection-name').fill('Discarded')
      await expect(save).toBeEnabled()
      await expect(dialog).toContainText('Unsaved changes')

      // an edit is not written while it is typed, and closing throws it away
      await page.waitForTimeout(900)
      expect(read().name).toBe('Fixture')

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      expect(read().name).toBe('Fixture')

      await editConnection(page, 'Fixture')
      dialog = page.getByRole('dialog')

      await expect(dialog.locator('#connection-name')).toHaveValue('Fixture')
      await dialog.locator('#connection-name').fill('Renamed')
      await dialog.getByRole('radiogroup', {name: 'Tag'}).getByText('production', {exact: true}).click()
      await dialog.getByRole('button', {name: 'Save', exact: true}).click()

      // Save writes the connection and closes the dialog
      await expect(dialog).toBeHidden()
      await expect.poll(() => read().name).toBe('Renamed')
      expect(read().tag).toBe('production')

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
