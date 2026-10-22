const {test, expect} = require('@playwright/test')

const {fixture, launchTinkr} = require('../support/tinkr')
const {chooseOutputView, runCode} = require('../support/actions')

test.describe('the app shell', () => {
  test('draws the window, the connection and the output views', async () => {
    const {app, page, close, errors} = await launchTinkr()

    try {
      await expect(page.locator('.titlebar .brand__word')).toHaveText('Tinkr')
      await expect(page.locator('.titlebar__center')).toContainText('Fixture')
      await expect(page.locator('.titlebar__center')).toContainText('local')
      await expect(page.locator('.statusbar')).toContainText('Connected · Fixture (local)')
      await expect(page.locator('.statusbar')).toContainText(/PHP \d+\.\d+/)
      await expect(page.locator('.statusbar')).toContainText('autocomplete off')
      await expect(page.locator('.statusbar')).toContainText('Tinkr 0.4.4')

      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('Fixture')
      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('No snippets yet')
      await expect(page.getByRole('navigation', {name: 'History'})).toContainText('No runs yet')
      await expect(page.getByRole('button', {name: 'Settings'})).toBeVisible()
      await expect(page.getByRole('button', {name: 'Logs'})).toBeVisible()

      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')

      const views = page.getByRole('tablist', {name: 'Output views'})

      await expect(views.getByRole('radio', {name: 'Output'})).toBeChecked()
      await chooseOutputView(page, 'Queries')
      await expect(page.getByText('Run the snippet to see the queries it sends.')).toBeVisible()
      await chooseOutputView(page, 'Terminal')
      await expect(page.getByRole('textbox', {name: 'Terminal input'})).toBeVisible()
      await chooseOutputView(page, 'AI')
      await expect(page.getByText('Ask for a snippet, or ask what the code in the editor does.')).toBeVisible()
      await chooseOutputView(page, 'Output')

      // the editor is the well, and the window opens on a session of its own
      await expect(page.getByRole('tablist', {name: 'Open documents'}).getByRole('tab')).toHaveCount(1)
      await expect(page.getByRole('tablist', {name: 'Open documents'}).getByRole('tab')).toContainText('Unsaved')
      await expect(page.locator('.editor .monaco-editor')).toBeVisible()

      expect(errors).toEqual([])

      const before = await app.evaluate(({BrowserWindow}) => ({
        controls: BrowserWindow.getAllWindows()[0].isMaximizable(),
        minimized: BrowserWindow.getAllWindows()[0].isMinimized(),
      }))

      // `controls` is whether the app draws them, and on linux it does; the
      // window itself is the only one on screen
      expect(before.minimized).toBe(false)
    } finally {
      await close()
    }
  })

  test('maximizes, restores and minimizes the real window', async () => {
    const {app, page, close} = await launchTinkr()

    try {
      const maximize = page.getByRole('button', {name: 'Maximize'})

      await maximize.click()
      // the main process is what knows: the button follows the event it sends
      await expect.poll(() => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isMaximized()))
        .toBe(true)
      await expect(page.getByRole('button', {name: 'Restore'})).toBeVisible()

      await page.getByRole('button', {name: 'Restore'}).click()
      await expect.poll(() => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isMaximized()))
        .toBe(false)
      await expect(maximize).toBeVisible()

      await page.getByRole('button', {name: 'Minimize'}).click()
      await expect.poll(() => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isMinimized()))
        .toBe(true)

      await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].restore())
      await expect.poll(() => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isMinimized()))
        .toBe(false)
    } finally {
      await close()
    }
  })

  test('quick connects to a directory picked from the platform dialog', async () => {
    const {app, page, close} = await launchTinkr({connections: null})

    try {
      // the picker is the platform's, so the answer it would give is what the
      // main process is given: everything after it — the connection, the
      // session and the run — is the app's own
      await app.evaluate(({dialog}, directory) => {
        dialog.showOpenDialogSync = () => [directory]
      }, fixture)

      await page.getByRole('navigation', {name: 'Connections'})
        .getByRole('button', {name: 'Quick Connect'})
        .click()

      await expect(page.locator('.statusbar')).toContainText('Connected · Quick Connection (local)')
      await expect(page.locator('.titlebar__center')).toContainText('Quick Connection')

      // the directory is what the session runs in, not only what the title
      // says: a class of the fixture project resolves only there
      await runCode(page, 'Order::count();')
      await expect(page.locator('.output .t-number').first()).toHaveText('3')

      // and a reconnect keeps it, though the store's placeholder has no path
      await page.getByRole('button', {name: 'Reconnect'}).click()
      await page.waitForTimeout(500)

      await runCode(page, 'Order::count();')
      await expect(page.locator('.output .t-number').first()).toHaveText('3')
    } finally {
      await close()
    }
  })

  test('focuses the snippet search with Ctrl+K', async () => {
    const {page, close} = await launchTinkr()

    try {
      await page.locator('.statusbar').click()
      await page.keyboard.press('Control+k')
      await expect(page.getByRole('searchbox', {name: 'Search snippets'})).toBeFocused()
    } finally {
      await close()
    }
  })

  test('opens with the quick connection when the store holds nothing', async () => {
    const {page, close} = await launchTinkr({connections: null})

    try {
      await page.locator('.statusbar').getByText(/Connected · Quick Connection/).waitFor()
      // the quick connection is the session, not one of the stored connections,
      // so it is named by the window rather than listed in the sidebar
      await expect(page.locator('.titlebar__center')).toContainText('Quick Connection')
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('0')
    } finally {
      await close()
    }
  })

  test('opens the AI prompt with its shortcut, and a new connection with its own', async () => {
    const {page, close} = await launchTinkr()

    try {
      await page.keyboard.press('Control+Shift+L')

      await expect(page.getByRole('radio', {name: 'AI'})).toBeChecked()
      await expect(page.getByRole('textbox', {name: 'AI'})).toBeFocused()

      // the prompt has the focus, and a shortcut typed into a field is not a
      // shortcut; the window itself takes it
      await page.locator('.statusbar').click()
      await page.keyboard.press('Meta+Shift+N')

      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('dialog').locator('#connection-name')).toHaveValue('New Connection')
    } finally {
      await close()
    }
  })
})
