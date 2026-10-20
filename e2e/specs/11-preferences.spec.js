const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {runCode} = require('../support/actions')

const configFile = profile => path.join(profile, 'Electron', 'app', 'config.json')
const readConfig = profile => JSON.parse(fs.readFileSync(configFile(profile), 'utf8'))

const openSettings = async (app, page) => {
  const [settings] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', {name: 'Settings'}).click(),
  ])

  await settings.locator('.app').waitFor({state: 'visible'})
  await expect(settings.locator('aside.rail')).toBeVisible()
  await settings.bringToFront()

  return settings
}

test.describe('preferences', () => {
  test('changes the theme, layout, statements, timeout, close prompt and defaults', async () => {
    const {app, page, profile, close} = await launchTinkr()

    try {
      const settings = await openSettings(app, page)

      // the rail has every section the app has
      for (const name of ['General', 'Shortcuts', 'Lab', 'AI', 'MCP']) {
        await expect(settings.locator('aside.rail').getByRole('button', {name})).toBeVisible()
      }

      await settings.getByRole('radiogroup', {name: 'Theme'}).getByText('Default', {exact: true}).click()
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
      await expect.poll(() => settings.evaluate(() => document.documentElement.dataset.theme)).toBe('light')

      await settings.getByRole('radiogroup', {name: 'Theme'}).getByText('Dark', {exact: true}).click()
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')

      await settings.getByRole('radiogroup', {name: 'Layout'}).getByText('Stacked', {exact: true}).click()
      await expect.poll(() => page.locator('.main').getAttribute('class')).not.toContain('main--side')

      await settings.getByRole('radiogroup', {name: 'Layout'}).getByText('Side by side', {exact: true}).click()
      await expect.poll(() => page.locator('.main').getAttribute('class')).toContain('main--side')

      await settings.getByRole('radiogroup', {name: 'Statements'}).getByText('Only the last', {exact: true}).click()

      await runCode(page, '$a = 2;\n$b = 3;\n$a + $b;')

      await expect(page.locator('.output')).toContainText('a number')
      await expect(page.locator('.output .block__line')).toHaveCount(0)

      await settings.getByLabel('Run timeout').fill('1500')
      await settings.locator('.setting').filter({has: settings.getByText('Ask before closing an unsaved session', {exact: true})}).locator('.switch__track').click()
      await settings.getByLabel('Default command').fill('php -d cli.pager=cat artisan tinker')
      await settings.getByLabel('Log files').fill('storage/logs')

      await expect.poll(() => readConfig(profile)).toMatchObject({
        theme: 'dark',
        editor_layout: 'side',
        result_blocks: 'last',
        run_timeout: '1500',
        confirm_close_session: false,
        command_default: 'php -d cli.pager=cat artisan tinker',
        log_dir: 'storage/logs',
      })
    } finally {
      await close()
    }
  })

  test('records a shortcut and runs with it', async () => {
    const {app, page, profile, close} = await launchTinkr()

    try {
      const settings = await openSettings(app, page)

      await settings.getByRole('button', {name: 'Shortcuts'}).click()
      await settings.locator('.setting')
        .filter({has: settings.getByText('Run Snippet Code', {exact: true})})
        .getByRole('button')
        .click()

      const dialog = settings.getByRole('dialog')

      await expect(dialog).toContainText('Press desired key combination and then press ENTER')

      const field = dialog.getByRole('textbox', {name: 'Press desired key combination and then press ENTER'})

      await field.focus()
      // the recorder keeps what is held; Enter is the answer
      await settings.keyboard.down('Control')
      await settings.keyboard.down('Shift')
      await settings.keyboard.down('R')
      await settings.keyboard.press('Enter')
      await settings.keyboard.up('R')
      await settings.keyboard.up('Shift')
      await settings.keyboard.up('Control')

      await expect(dialog).toHaveCount(0)
      await expect.poll(() => readConfig(profile).shortcut_run).toEqual(['Control', 'Shift', 'R'])

      await page.locator('.editor .monaco-editor').click()
      await page.keyboard.press('Control+a')
      await page.keyboard.insertText('6 * 7;')
      await page.keyboard.press('Control+Shift+R')

      await expect(page.locator('.output')).toContainText('42', {timeout: 60_000})
    } finally {
      await close()
    }
  })

  test('switches the interface language', async () => {
    const {app, page, profile, close} = await launchTinkr()

    try {
      const settings = await openSettings(app, page)

      await settings.getByLabel('Locale').selectOption('es')

      await expect(settings.locator('aside.rail')).toBeVisible()
      await expect(settings.getByText('Preferencias', {exact: true})).toBeVisible()
      await expect(settings.getByText('Tema', {exact: true})).toBeVisible()
      await expect(page.getByRole('navigation', {name: 'Conexiones'})).toBeVisible()
      await expect(page.getByRole('navigation', {name: 'Fragmentos'})).toBeVisible()
      await expect(page.getByRole('navigation', {name: 'Historial'})).toBeVisible()

      expect(readConfig(profile).locale).toBe('es')

      // the select is the only one in the general section, whatever language it
      // is labelled in
      await settings.locator('.settings select').selectOption('en')

      await expect(settings.locator('aside.rail')).toBeVisible()
      await expect(page.getByRole('navigation', {name: 'Snippets'})).toBeVisible()

      expect(readConfig(profile).locale).toBe('en')
    } finally {
      await close()
    }
  })

  test('turns the snippet form and its prefix on and off', async () => {
    const {app, page, profile, close} = await launchTinkr({
      snippets: {
        fixture: {
          form: {
            id: 'form',
            name: 'Form',
            code: "$field_name = 'Tinkr';",
            position: null,
          },
        },
      },
    })

    try {
      const settings = await openSettings(app, page)

      await settings.getByRole('button', {name: 'Lab'}).click()

      await expect(settings.getByLabel("Snippet form's variable prefix")).toHaveValue('field_')

      await settings.locator('.setting').filter({has: settings.getByText('Snippet form', {exact: true})}).locator('.switch__track').click()
      await expect.poll(() => readConfig(profile).form_switch).toBe(false)

      await page.getByRole('navigation', {name: 'Snippets'}).getByRole('button', {name: 'Form'}).click()
      await expect(page.getByRole('button', {name: 'Snippet Form'})).toHaveCount(0)

      await settings.locator('.setting').filter({has: settings.getByText('Snippet form', {exact: true})}).locator('.switch__track').click()
      await expect.poll(() => readConfig(profile).form_switch).toBe(true)
      await expect(page.getByRole('button', {name: 'Snippet Form'})).toBeVisible()

      await settings.getByLabel("Snippet form's variable prefix").fill('var_')
      await expect.poll(() => readConfig(profile).form_prefix).toBe('var_')

      // the form the window already has is about the prefix it was opened with;
      // the field the code declares is the new one
      await page.getByRole('button', {name: 'Snippet Form'}).click()
      await expect(page.locator('.editor .empty--benign')).toContainText('No fields')
    } finally {
      await close()
    }
  })
})
