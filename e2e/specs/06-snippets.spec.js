const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {runCode, setEditorCode} = require('../support/actions')

const snippetFile = (profile, connection = 'fixture') => path.join(
  profile, 'Electron', 'app', 'snippets', `${connection}.json`
)

const seedOne = (overrides = {}) => ({
  snippets: {
    fixture: {
      first: Object.assign({id: 'first', name: 'First', code: '1 + 1;', position: null}, overrides),
    },
  },
})

const openSnippet = async (page, name) => {
  await page.getByRole('navigation', {name: 'Snippets'}).getByRole('button', {name}).click()
}

test.describe('snippets', () => {
  test('saves the session as a snippet, and the tab names it', async () => {
    const {page, profile, close} = await launchTinkr()

    try {
      await setEditorCode(page, '$answer = 6 * 7;')
      await page.getByRole('button', {name: 'Save', exact: true}).click()

      const dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('Save Snippet')
      await expect(dialog.locator('#snippet-name')).toHaveValue('New Snippet')

      await dialog.locator('#snippet-name').fill('The answer')
      await dialog.getByRole('button', {name: 'Save', exact: true}).click()

      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('The answer')
      await expect(page.locator('.tab--active input.tab__name')).toHaveValue('The answer')
      await expect(page.locator('.tab--active')).toHaveAttribute('title', 'The answer')

      await expect.poll(() => {
        const file = snippetFile(profile)

        return Object.values(JSON.parse(fs.readFileSync(file, 'utf8'))).map(snippet => snippet.name)
      }).toEqual(['The answer'])

      const stored = Object.values(JSON.parse(fs.readFileSync(snippetFile(profile), 'utf8')))[0]

      expect(stored.code).toBe('$answer = 6 * 7;')
      expect(stored.id).toBeTruthy()
    } finally {
      await close()
    }
  })

  test('shows a snippet another process wrote, without a restart', async () => {
    const {page, profile, close} = await launchTinkr(seedOne())

    try {
      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('First')

      const file = snippetFile(profile)
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'))

      fs.writeFileSync(file, JSON.stringify(Object.assign({}, stored, {
        outside: {id: 'outside', name: 'From outside', code: '2 + 2;', position: null},
      })))

      // the MCP server writes the same file, and the window is watching it
      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('From outside', {timeout: 15_000})
    } finally {
      await close()
    }
  })

  test('filters the list from the sidebar search', async () => {
    const {page, close} = await launchTinkr({
      snippets: {
        fixture: {
          alpha: {id: 'alpha', name: 'Alpha sum', code: '1;', position: null},
          beta: {id: 'beta', name: 'Beta count', code: '2;', position: null},
        },
      },
    })

    try {
      const list = page.getByRole('navigation', {name: 'Snippets'})

      await expect(list).toContainText('Alpha sum')
      await expect(list).toContainText('Beta count')

      await page.getByRole('searchbox', {name: 'Search snippets'}).fill('alp')

      await expect(list).toContainText('Alpha sum')
      await expect(list).not.toContainText('Beta count')

      await page.getByRole('searchbox', {name: 'Search snippets'}).fill('zzz')

      await expect(list).toContainText('No snippets match')

      await page.getByRole('searchbox', {name: 'Search snippets'}).fill('')
      await expect(list).toContainText('Beta count')
    } finally {
      await close()
    }
  })

  test('renames from the open tab and from the snippet menu', async () => {
    const {page, profile, close} = await launchTinkr(seedOne())

    try {
      await openSnippet(page, 'First')
      await expect(page.locator('.tab--active input.tab__name')).toHaveValue('First')

      await page.locator('.tab--active input.tab__name').fill('Renamed in tab')
      await page.waitForTimeout(400)

      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('Renamed in tab')

      // the menu's Rename asks for a name rather than editing in place
      await page.getByRole('navigation', {name: 'Snippets'})
        .getByRole('button', {name: 'Renamed in tab'})
        .click({button: 'right'})

      const menu = page.getByRole('menu', {name: 'Renamed in tab'})

      await expect(menu).toBeVisible()
      await menu.getByRole('menuitem', {name: 'Rename Snippet'}).click()

      const dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('Rename Snippet')
      await dialog.locator('#snippet-name').fill('Renamed from menu')
      await dialog.getByRole('button', {name: 'Rename', exact: true}).click()

      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('Renamed from menu')

      const stored = JSON.parse(fs.readFileSync(snippetFile(profile), 'utf8'))

      expect(stored.first.name).toBe('Renamed from menu')
    } finally {
      await close()
    }
  })

  test('deletes a snippet after asking, and closes its tab', async () => {
    const {page, profile, close} = await launchTinkr(seedOne())

    try {
      await openSnippet(page, 'First')

      await page.getByRole('navigation', {name: 'Snippets'})
        .getByRole('button', {name: 'First'})
        .click({button: 'right'})

      await page.getByRole('menu').getByRole('menuitem', {name: 'Delete'}).click()

      const dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('Are you absolutely sure?')
      await expect(dialog).toContainText('First')

      await dialog.getByRole('button', {name: 'Cancel'}).click()
      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('First')

      await page.getByRole('navigation', {name: 'Snippets'})
        .getByRole('button', {name: 'First'})
        .click({button: 'right'})
      await page.getByRole('menu').getByRole('menuitem', {name: 'Delete'}).click()
      await page.getByRole('dialog').getByRole('button', {name: 'Delete Snippet'}).click()

      await expect(page.getByRole('navigation', {name: 'Snippets'})).toContainText('No snippets yet')
      await expect(page.getByRole('tab')).toHaveCount(1)

      expect(JSON.parse(fs.readFileSync(snippetFile(profile), 'utf8'))).toEqual({})
    } finally {
      await close()
    }
  })

  test('draws the snippet form from its fields and runs what the form holds', async () => {
    const {page, close} = await launchTinkr({
      snippets: {
        fixture: {
          form: {
            id: 'form',
            name: 'Greeting',
            code: "$field_name = 'World';\n$field_count = 2;\necho str_repeat('Hello ', $field_count) . $field_name;",
            position: null,
          },
        },
      },
    })

    try {
      await openSnippet(page, 'Greeting')
      await page.getByRole('button', {name: 'Snippet Form'}).click()

      await expect(page.locator('.form-row')).toHaveCount(3)
      await expect(page.getByLabel('$field_name')).toHaveValue('World')
      await expect(page.getByLabel('$field_count')).toHaveValue('2')

      await page.getByLabel('$field_name').fill('Tinkr')
      await page.locator('.editor form.form-grid button.btn--run').click()

      await expect(page.locator('.output')).toContainText('Hello Hello Tinkr', {timeout: 60_000})

      // the button toggles back to the code, which the form has not changed
      await page.getByRole('button', {name: 'Edit the code'}).click()
      await expect(page.locator('.editor .monaco-editor')).toBeVisible()
    } finally {
      await close()
    }
  })

  test('says a snippet has no form fields, and offers the code', async () => {
    const {page, close} = await launchTinkr({
      snippets: {
        fixture: {
          plain: {id: 'plain', name: 'Plain', code: "echo 'no fields';", position: null},
        },
      },
    })

    try {
      await openSnippet(page, 'Plain')
      await page.getByRole('button', {name: 'Snippet Form'}).click()

      await expect(page.locator('.editor .empty--benign')).toContainText('No fields, try to add some variables prefixed with')
      const edit = page.locator('.editor .empty--benign').getByRole('button', {name: 'Edit the code'})

      await expect(edit).toBeVisible()
      await edit.click()
      await expect(page.locator('.editor .monaco-editor')).toBeVisible()
    } finally {
      await close()
    }
  })

  test('follows the form prefix preference', async () => {
    const {page, close} = await launchTinkr({
      config: {form_prefix: 'var_'},
      snippets: {
        fixture: {
          prefixed: {
            id: 'prefixed',
            name: 'Prefixed',
            code: "$var_name = 'Tinkr';\necho $var_name;",
            position: null,
          },
        },
      },
    })

    try {
      await openSnippet(page, 'Prefixed')
      await page.getByRole('button', {name: 'Snippet Form'}).click()

      await expect(page.locator('.form-row')).toHaveCount(2)
      await expect(page.getByLabel('$var_name')).toHaveValue('Tinkr')
    } finally {
      await close()
    }
  })

  test('does not offer a form when the feature is switched off', async () => {
    const {page, close} = await launchTinkr(Object.assign(seedOne(), {config: {form_switch: false}}))

    try {
      await openSnippet(page, 'First')
      await expect(page.getByRole('button', {name: 'Snippet Form'})).toHaveCount(0)
    } finally {
      await close()
    }
  })

  test('shows the caret position in the status bar while a snippet is open', async () => {
    const {page, close} = await launchTinkr(seedOne())

    try {
      await openSnippet(page, 'First')
      await setEditorCode(page, '1 + 1;\n2 + 2;')
      await page.keyboard.press('Control+End')

      await expect(page.locator('.statusbar')).toContainText(/Ln 2, Col \d+/)
    } finally {
      await close()
    }
  })
})
