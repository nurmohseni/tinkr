const {test, expect} = require('@playwright/test')

const {fixtureConnection, launchTinkr} = require('../support/tinkr')
const {runCode, setEditorCode} = require('../support/actions')

const production = () => launchTinkr({
  connections: [fixtureConnection({tag: 'production'})],
})

test.describe('the production gate', () => {
  test('holds a write behind a question, and sends the run only when answered', async () => {
    const {page, close} = await launchTinkr({
      connections: [fixtureConnection({tag: 'production'})],
    })

    try {
      // the row says production where a run is started from
      await expect(page.getByRole('navigation', {name: 'Connections'})).toContainText('production')

      // a read is not a write and asks nothing
      await runCode(page, 'Order::count();')
      await expect(page.locator('.output')).toContainText('3')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await setEditorCode(page, "DB::update('update orders set paid = 1 where id = 1');")
      await page.locator('.tabbar .btn--run').first().click()

      const dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('This run changes the database')
      await expect(dialog).toContainText('Fixture')
      await expect(dialog).toContainText('update')
      await expect(dialog).toContainText('line 1')

      await dialog.getByRole('button', {name: 'Cancel'}).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      // nothing was sent, so the ledger has only the read
      await expect(page.getByRole('navigation', {name: 'History'}).locator('.tree-nav__row--run')).toHaveCount(1)

      // the same run, answered
      await page.locator('.tabbar .btn--run').first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('dialog').getByRole('button', {name: 'Run anyway'}).click()

      await expect(page.locator('.output')).toContainText('returned', {timeout: 60_000})
      await expect(page.getByRole('navigation', {name: 'History'}).locator('.tree-nav__row--run')).toHaveCount(2)
    } finally {
      await close()
    }
  })

  test('asks about what a dry run cannot take back, and still guards an ordinary write', async () => {
    const {page, close} = await production()

    try {
      await page.getByRole('button', {name: 'Turn on dry run: the run is rolled back when it is done'}).click()

      await setEditorCode(page, "Schema::create('orders_backup', function ($table) {});")
      await page.locator('.tabbar .btn--run').first().click()

      let dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('The dry run cannot take this back')
      await expect(dialog).toContainText('Schema::create')
      await expect(dialog).toContainText('DDL, which MySQL commits on its own')
      await dialog.getByRole('button', {name: 'Cancel'}).click()

      // an ordinary update is inside the transaction, so the dry run is enough
      await setEditorCode(page, "DB::update('update orders set paid = 1 where id = 1');")
      await page.locator('.tabbar .btn--run').first().click()

      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.output .guard')).toContainText('Rolled back 1 statement on fixture', {timeout: 60_000})
    } finally {
      await close()
    }
  })
})
