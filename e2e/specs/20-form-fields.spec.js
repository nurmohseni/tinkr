const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')

const fields = `$field_choice = ['label' => 'Choice', 'value' => 'b', 'type' => 'select', 'options' => [['value' => 'a', 'label' => 'Alpha'], ['value' => 'b', 'label' => 'Beta']]];
$field_flag = ['label' => 'Flag', 'value' => 'false', 'type' => 'checkbox', 'description' => 'turn it on'];
$field_note = ['label' => 'Note', 'value' => 'hello', 'type' => 'textarea'];
echo $field_choice . '|' . $field_flag . '|' . $field_note;`

test.describe('declared form fields', () => {
  test('draws a select, a checkbox and a textarea, and runs what they hold', async () => {
    const {page, close} = await launchTinkr({
      snippets: {
        fixture: {
          declared: {id: 'declared', name: 'Declared', code: fields, position: null},
        },
      },
    })

    try {
      await page.getByRole('navigation', {name: 'Snippets'}).getByRole('button', {name: 'Declared'}).click()
      await page.getByRole('button', {name: 'Snippet Form'}).click()

      const choice = page.getByLabel('Choice')
      const flag = page.getByRole('checkbox')
      const note = page.getByLabel('Note')

      await expect(choice).toHaveValue('b')
      await expect(choice.locator('option')).toHaveCount(2)
      await expect(choice.locator('option')).toHaveText(['Alpha', 'Beta'])
      await expect(flag).not.toBeChecked()
      await expect(page.getByText('turn it on')).toBeVisible()
      await expect(note).toHaveValue('hello')

      await choice.selectOption('a')
      await page.getByText('turn it on').click()
      await expect(flag).toBeChecked()
      await note.fill('changed')

      await page.locator('.editor form.form-grid button.btn--run').click()

      await expect(page.locator('.output pre.printed')).toContainText('a|1|changed', {timeout: 60_000})
    } finally {
      await close()
    }
  })

  test('resolves a field written as a closure through the session', async () => {
    const {page, close} = await launchTinkr({
      snippets: {
        fixture: {
          closure: {
            id: 'closure',
            name: 'Closure',
            code: "$field_name = function () { return 'World'; };\necho $field_name;",
            position: null,
          },
        },
      },
    })

    try {
      await page.getByRole('navigation', {name: 'Snippets'}).getByRole('button', {name: 'Closure'}).click()
      await page.getByRole('button', {name: 'Snippet Form'}).click()

      const field = page.getByLabel('$field_name')

      // the session was asked what the closure returns, so the form shows the
      // answer rather than the code
      await expect(field).toHaveValue('World', {timeout: 20_000})

      await field.fill('Tinkr')
      await page.locator('.editor form.form-grid button.btn--run').click()

      await expect(page.locator('.output pre.printed')).toContainText('Tinkr', {timeout: 60_000})
    } finally {
      await close()
    }
  })
})
