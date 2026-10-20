const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {chooseOutputView} = require('../support/actions')

test.describe('the terminal', () => {
  test('sends what is typed to the session and shows what it prints', async () => {
    const {page, close} = await launchTinkr()

    try {
      await chooseOutputView(page, 'Terminal')
      await expect(page.getByRole('textbox', {name: 'Terminal input'})).toBeVisible()

      // the output pane keeps an xterm of its own behind the result; the view in
      // hand is the one the click focuses
      const terminal = page.locator('.xterm').first()

      await terminal.click()
      await page.keyboard.type("echo 'terminal-ok';")
      await page.keyboard.press('Enter')

      // the typed line is echoed by the pty and the value is written by the
      // session: both are the terminal's, and both arrive through the bridge
      await expect(page.locator('.xterm').first()).toContainText('terminal-ok', {timeout: 15_000})

      // a second line is the same session, not a restarted one
      await page.keyboard.type("echo 'still-here';")
      await page.keyboard.press('Enter')

      await expect(page.locator('.xterm').first()).toContainText('still-here', {timeout: 15_000})
    } finally {
      await close()
    }
  })
})
