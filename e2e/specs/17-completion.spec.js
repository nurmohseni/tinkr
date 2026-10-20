const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {runEditor} = require('../support/actions')

test.describe('the completion popup', () => {
  test('offers the project\'s classes, and inserts the one that was chosen', async () => {
    const {page, close} = await launchTinkr()

    try {
      // the index is read beside the session, so give it the moment a person
      // would take before typing
      await page.waitForTimeout(1500)
      await page.locator('.editor .monaco-editor').click()
      await page.keyboard.insertText('Ord')

      await page.keyboard.press('Control+Space')

      const widget = page.locator('.suggest-widget')

      await expect(widget).toBeVisible({timeout: 15_000})
      await expect(widget).toContainText('Order')
      await expect(widget).toContainText('App\\Models\\Order')

      await page.keyboard.press('Enter')
      await page.keyboard.insertText('::count();')

      // the chosen name is in the well and resolves in the session: the model's
      // own count is the run's answer
      await runEditor(page)

      await expect(page.locator('.output .t-number').first()).toHaveText('3')
    } finally {
      await close()
    }
  })

  test('offers the methods of the class a :: was written after', async () => {
    const {page, close} = await launchTinkr()

    try {
      await page.waitForTimeout(1500)
      await page.locator('.editor .monaco-editor').click()
      await page.keyboard.insertText('Order::')

      await page.keyboard.press('Control+Space')

      const widget = page.locator('.suggest-widget')

      await expect(widget).toBeVisible({timeout: 20_000})
      await expect(widget).toContainText('count')
      await expect(widget).toContainText('all')
      await expect(widget).toContainText('where')
    } finally {
      await close()
    }
  })
})
