const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {outputText, runCode} = require('../support/actions')

test.describe('the app boots and runs code', () => {
  test('opens the fixture connection and answers 1 + 1 through the real session', async () => {
    const {page, close, errors} = await launchTinkr()

    try {
      await expect(page.locator('.titlebar .brand__word')).toHaveText('Tinkr')
      await expect(page.locator('.statusbar')).toContainText('Connected · Fixture (local)')
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('Fixture')
      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('No snippets yet')
      await expect(page.getByRole('navigation', {name: 'History'})).toContainText('No runs yet')

      await runCode(page, '1 + 1;')

      const text = await outputText(page)

      expect(text).toContain('returned')
      expect(text).toContain('a number')
      expect(text).toContain('2')
      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })
})
