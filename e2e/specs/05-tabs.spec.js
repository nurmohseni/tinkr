const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {runCode, setEditorCode} = require('../support/actions')

test.describe('tabs and sessions', () => {
  test('each session keeps its own code and its own answer', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, '1 + 1;')
      await expect(page.locator('.output .t-number').first()).toHaveText('2')

      await page.locator('.tabbar__new').click()
      await expect(page.getByRole('tablist', {name: 'Open documents'}).getByRole('tab')).toHaveCount(2)

      await runCode(page, '10 + 10;')
      await expect(page.locator('.output .t-number').first()).toHaveText('20')

      await page.getByRole('tab', {name: /Unsaved/}).nth(0).click()
      await expect(page.locator('.output .t-number').first()).toHaveText('2')

      await page.getByRole('tab', {name: /Unsaved/}).nth(1).click()
      await expect(page.locator('.output .t-number').first()).toHaveText('20')
    } finally {
      await close()
    }
  })

  test('marks a tab edited since its last run', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, '1 + 1;')

      const tab = page.getByRole('tablist', {name: 'Open documents'}).getByRole('tab').first()

      await expect(tab.locator('.tab__dot')).toHaveCount(0)

      await page.locator('.editor .monaco-editor').click()
      await page.keyboard.type(' ')

      await page.mouse.move(600, 400)
      await expect(tab.locator('.tab__dot')).toBeVisible()

      // the mark is about the code the tab last sent, so running it again clears
      // it, whichever tab the window moved to in between
      await page.locator('.tabbar__new').click()
      await page.getByRole('tab').nth(0).click()
      await page.mouse.move(600, 400)
      await expect(tab.locator('.tab__dot')).toBeVisible()

      await page.locator('.tabbar .btn--run').first().click()
      await expect(tab.locator('.tab__dot')).toHaveCount(0, {timeout: 60_000})
    } finally {
      await close()
    }
  })

  test('runs the tab on screen from the Ctrl+R binding after another tab is opened', async () => {
    const {page, close} = await launchTinkr()

    try {
      const button = page.locator('.tabbar .btn--run').first()
      const output = page.locator('.output')

      await setEditorCode(page, '1 + 1;')
      await page.keyboard.press('Control+r')
      await expect(output.locator('.t-number').first()).toHaveText('2', {timeout: 60_000})
      await expect(button).not.toHaveClass(/btn--danger/, {timeout: 60_000})

      // the action the shortcut fires is registered once, with the editor, so
      // this is the binding that used to run the document the window opened on
      await page.locator('.tabbar__new').click()
      await expect(page.getByRole('tablist', {name: 'Open documents'}).getByRole('tab')).toHaveCount(2)

      await setEditorCode(page, '10 + 10;')
      // the code reached the store of the tab on screen, which is what makes the
      // well writable and the button pressable
      await expect(button).toBeEnabled({timeout: 10_000})
      await page.keyboard.press('Control+r')

      await expect(output.locator('.t-number').first()).toHaveText('20', {timeout: 60_000})
    } finally {
      await close()
    }
  })

  test('asks before closing a session that holds code, and can remember the answer', async () => {
    const {page, profile, close} = await launchTinkr()

    try {
      await page.locator('.tabbar__new').click()
      await setEditorCode(page, '1 + 1;')

      const second = page.getByRole('tab').nth(1)

      await second.locator('.tab__close').click()
      await expect(page.getByRole('dialog')).toContainText('Close this session?')

      await page.getByRole('dialog').getByRole('button', {name: 'Cancel'}).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('tab')).toHaveCount(2)

      await second.locator('.tab__close').click()
      await page.getByRole('dialog').getByRole('button', {name: 'Discard'}).click()

      await expect(page.getByRole('tab')).toHaveCount(1)
      await expect(page.getByRole('dialog')).toHaveCount(0)

      // the standing answer is a preference, and it is written where the next
      // window reads it
      await page.locator('.tabbar__new').click()
      await setEditorCode(page, '2 + 2;')
      await page.getByRole('tab').nth(1).locator('.tab__close').click()

      const dialog = page.getByRole('dialog')

      await dialog.getByText('Do not show this warning again').click()
      await dialog.getByRole('button', {name: 'Discard'}).click()
      await expect(page.getByRole('tab')).toHaveCount(1)

      await expect.poll(() => JSON.parse(
        require('fs').readFileSync(`${profile}/Electron/app/config.json`, 'utf8')
      ).confirm_close_session).toBe(false)

      // and a second session with code closes without asking
      await page.locator('.tabbar__new').click()
      await setEditorCode(page, '3 + 3;')
      await page.getByRole('tab').nth(1).locator('.tab__close').click()

      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('tab')).toHaveCount(1)
    } finally {
      await close()
    }
  })

  test('closes a snippet tab without asking, and leaves the snippet in the store', async () => {
    const {page, close} = await launchTinkr({
      snippets: {
        fixture: {
          keepme: {id: 'keepme', name: 'Keep me', code: '1 + 1;', position: null},
        },
      },
    })

    try {
      await page.getByRole('navigation', {name: 'Snippets'}).getByRole('button', {name: 'Keep me'}).click()
      await expect(page.getByRole('tab')).toHaveCount(2)

      await page.getByRole('tab').nth(1).locator('.tab__close').click()

      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('tab')).toHaveCount(1)
      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('Keep me')
    } finally {
      await close()
    }
  })
})
