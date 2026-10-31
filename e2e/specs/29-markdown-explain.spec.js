const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {launchTinkr, profileApp} = require('../support/tinkr')
const {chooseOutputView, runCode} = require('../support/actions')

const clipboard = app => app.evaluate(({clipboard: system}) => system.readText())

const historyOf = profile => {
  const file = path.join(profileApp(profile), 'history', 'fixture.json')

  if (!fs.existsSync(file)) {
    return []
  }

  return JSON.parse(fs.readFileSync(file, 'utf8')).entries || []
}

test.describe('taking a run out of the app and reading a plan', () => {
  test('copies the run as Markdown, and explains a select without making a run of it', async () => {
    const {app, page, profile, close} = await launchTinkr()

    try {
      await page.bringToFront()
      // one run, both kinds of statement: the select is what offers a plan, and
      // the write beside it is what must not
      await runCode(page, [
        "DB::select('select * from orders where paid = ?', [1]);",
        "DB::update('update orders set paid = 1 where id = 1');",
      ].join('\n'))

      // the whole run, from the summary's own actions: the connection, when it
      // ran, the code, every value and the queries table the panes read
      await page.getByRole('button', {name: 'Markdown'}).click()

      await expect.poll(() => clipboard(app)).toContain('```php')

      const markdown = await clipboard(app)

      expect(markdown).toContain('Connection: Fixture')
      expect(markdown).toContain('When:')
      expect(markdown).toContain("DB::select('select * from orders where paid = ?', [1]);")
      expect(markdown).toContain('```json')
      expect(markdown).toContain('"customer": "Ada"')
      expect(markdown).toContain('| # | sql | bindings | ms | connection |')
      expect(markdown).toContain('select * from orders where paid = ?')
      expect(markdown).toContain('update orders set paid = 1 where id = 1')
      expect(markdown).toContain('| 1 |')
      expect(markdown).toContain('| 2 |')
      expect(markdown).not.toMatch(/^#/m)

      const before = historyOf(profile)

      await chooseOutputView(page, 'Queries')

      // a select offers its plan; the write below it does not
      const explain = page.getByRole('button', {name: 'Explain'})

      await expect(explain).toHaveCount(1)

      const update = page.locator('table.qtable--values tbody tr').filter({hasText: 'update orders'})

      await expect(update.getByRole('button', {name: 'Explain'})).toHaveCount(0)

      await explain.click()

      // sqlite answers EXPLAIN QUERY PLAN, and its steps are a table under the
      // row they explain
      const plan = page.locator('.queries__plan')

      await expect(plan.locator('table.plan__table')).toBeVisible()
      await expect(plan.locator('thead')).toContainText('detail')
      await expect(plan.locator('tbody')).toContainText('orders')
      await expect(plan).toContainText('Plan from sqlite')

      // asked out of band: no run was made of the explain
      await expect.poll(() => historyOf(profile).length).toBe(before.length)
      expect(historyOf(profile).map(entry => entry.code)).not.toContainEqual(expect.stringContaining('EXPLAIN'))

      // and the explain did not become the run's last query log either: the
      // log still holds the run's two statements and no EXPLAIN of its own
      await expect(page.locator('.output').getByRole('button', {name: 'Copy SQL'})).toBeVisible()

      const logged = page.locator('table.qtable--values tbody > tr:has(td.qtable__index)')

      await expect(logged).toHaveCount(2)
    } finally {
      await close()
    }
  })
})
