const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {fixture, launchTinkr} = require('../support/tinkr')
const {editConnection, openNewConnection} = require('../support/actions')

const appFile = (profile, name) => path.join(profile, 'Electron', 'app', name)

const remote = {
  id: 'remote',
  name: 'Remote',
  path: '/srv/app',
  command: 'php artisan tinker',
  is_over_ssh: true,
  ssh_server: '127.0.0.1',
  ssh_port: '2222',
  ssh_user: 'deploy',
  ssh_password: false,
  tag: 'staging',
}

test.describe('the platform file pickers', () => {
  test('fills the connection path from the directory picker', async () => {
    const {app, page, close} = await launchTinkr()

    try {
      await openNewConnection(page)
      await app.evaluate(({dialog}, directory) => {
        dialog.showOpenDialogSync = () => [directory]
      }, fixture)

      const dialog = page.getByRole('dialog')

      await dialog.getByRole('button', {name: 'Select directory...'}).click()

      await expect(dialog.locator('#connection-path')).toHaveValue(fixture)
      await expect(dialog.locator('#connection-path')).toHaveValue(/.+e2e\/fixtures\/app$/)
    } finally {
      await close()
    }
  })

  test('imports the SSH key the file picker answers with', async () => {
    const {app, page, profile, close} = await launchTinkr({connections: [remote]})

    try {
      // the pencil on the row opens the connection's settings
      await editConnection(page, 'Remote')

      const key = path.join(fixture, 'composer.json')

      await app.evaluate(({dialog}, file) => {
        dialog.showOpenDialogSync = () => [file]
      }, key)

      const dialog = page.getByRole('dialog')

      await expect(dialog.locator('#connection-ssh-key')).toContainText('Import a private key...')
      await dialog.locator('#connection-ssh-key').click()

      await expect(dialog.locator('#connection-ssh-key')).toContainText('composer.json')
      await dialog.getByRole('button', {name: 'Save', exact: true}).click()

      await expect.poll(() => JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8')).remote.ssh_key)
        .toBe(key)
    } finally {
      await close()
    }
  })
})
