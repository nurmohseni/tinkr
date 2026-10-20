const {test, expect} = require('@playwright/test')

const {fixtureConnection, launchTinkr} = require('../support/tinkr')

const send = (app, channel, payload) => app.evaluate(({BrowserWindow}, message) => {
  BrowserWindow.getAllWindows()[0].webContents.send(message.channel, message.payload)
}, {channel, payload})

test.describe('the update prompt', () => {
  test('asks before downloading, and offers the restart once it is downloaded', async () => {
    const {app, page, close} = await launchTinkr()

    try {
      await send(app, 'updateAvailable', {version: '9.9.9'})

      let dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('A new version is ready')
      await expect(dialog).toContainText('Tinkr 9.9.9 can be downloaded now.')
      await expect(dialog.getByRole('button', {name: 'Download'})).toBeVisible()
      await expect(dialog.getByRole('button', {name: 'Later'})).toBeVisible()

      await dialog.getByRole('button', {name: 'Later'}).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await send(app, 'updateAvailable', {version: '9.9.9'})
      await send(app, 'updateDownloaded', {version: '9.9.9'})

      dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('The update is downloaded')
      await expect(dialog).toContainText('Tinkr 9.9.9 installs when the app closes')
      await expect(dialog.getByRole('button', {name: 'Restart and install'})).toBeVisible()

      // closing the prompt is the same answer the app will take on quit
      await dialog.getByRole('button', {name: 'Later'}).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } finally {
      await close()
    }
  })

  test('warns that nothing answered about php, and lets a run go ahead anyway', async () => {
    const {page, close} = await launchTinkr({
      // a command whose php is not on this machine is one the question about
      // php cannot be answered for
      connections: [fixtureConnection({command: 'php8.9 artisan tinker'})],
    })

    try {
      const warning = page.getByRole('alert').filter({hasText: 'No php answered here'})

      await expect(warning).toBeVisible({timeout: 20_000})
      await expect(warning).toContainText('This connection did not answer')

      await warning.getByRole('button', {name: 'Run tinker anyway'}).click()

      await expect(warning).toHaveCount(0)
      await expect(page.locator('.statusbar')).not.toContainText(/PHP \d/)
    } finally {
      await close()
    }
  })
})
