const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {chooseKind, editConnection} = require('../support/actions')

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

const openSettings = page => editConnection(page, 'Remote')

test.describe('the ssh password', () => {
  test('is kept out of the connection store, never shown back, and can be forgotten', async () => {
    const {page, profile, close} = await launchTinkr({connections: [remote]})

    try {
      await openSettings(page)

      const dialog = page.getByRole('dialog')
      const password = dialog.locator('#connection-ssh-password')

      await expect(password).toHaveValue('')
      await expect(password).toHaveAttribute('placeholder', "the server's password")
      await expect(dialog).not.toContainText('The password is kept')

      await password.fill('correct horse battery staple')
      await dialog.getByRole('button', {name: 'Save', exact: true}).click()
      await expect(dialog).toBeHidden()

      await expect.poll(() => JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8')).remote.ssh_password)
        .toBe(true)

      const secrets = JSON.parse(fs.readFileSync(appFile(profile, 'secrets.json'), 'utf8'))
      const stored = JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8'))

      expect(secrets).toEqual({remote: 'correct horse battery staple'})
      expect(stored.remote.password).toBeUndefined()
      expect(fs.statSync(appFile(profile, 'secrets.json')).mode & 0o777).toBe(0o600)

      // the value itself is not in the page, not in the store and not in the
      // connection; the dialog says a password is kept when it is opened again
      expect(await page.content()).not.toContain('correct horse battery staple')

      await openSettings(page)

      await expect(dialog).toContainText('The password is kept on this machine and is never shown again.')
      await expect(dialog.locator('#connection-ssh-password')).toHaveValue('')
      await expect(dialog.locator('#connection-ssh-password')).toHaveAttribute('placeholder', 'saved')
      expect(await page.content()).not.toContain('correct horse battery staple')

      await dialog.getByRole('button', {name: 'Forget it'}).click()

      await expect(dialog.locator('#connection-ssh-password')).toHaveAttribute('placeholder', "the server's password")
      await expect(dialog).not.toContainText('The password is kept')

      await expect.poll(() => JSON.parse(fs.readFileSync(appFile(profile, 'secrets.json'), 'utf8')))
        .toEqual({})
      await expect.poll(() => JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8')).remote.ssh_password)
        .toBe(false)
    } finally {
      await close()
    }
  })

  test('keeps the port it was given', async () => {
    const {page, profile, close} = await launchTinkr({connections: [remote]})

    try {
      await openSettings(page)

      const dialog = page.getByRole('dialog')

      await expect(dialog.locator('#connection-ssh-port')).toHaveValue('2222')

      await dialog.locator('#connection-ssh-port').fill('2200')
      await dialog.getByRole('button', {name: 'Save', exact: true}).click()

      await expect.poll(() => JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8')).remote.ssh_port)
        .toBe('2200')
    } finally {
      await close()
    }
  })

  test('is dropped when the connection is changed back to local', async () => {
    const {page, profile, close} = await launchTinkr({
      connections: [Object.assign({}, remote, {ssh_password: true})],
      secrets: {remote: 'a password kept on disk'},
    })

    try {
      await openSettings(page)

      const dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('The password is kept on this machine and is never shown again.')

      await chooseKind(page, 'local')
      await dialog.getByRole('button', {name: 'Save', exact: true}).click()

      await expect.poll(() => JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8')).remote.is_over_ssh)
        .toBe(false)

      const stored = JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8'))

      expect(stored.remote.ssh_password).toBe(false)
      expect(JSON.parse(fs.readFileSync(appFile(profile, 'secrets.json'), 'utf8'))).toEqual({})
    } finally {
      await close()
    }
  })
})
