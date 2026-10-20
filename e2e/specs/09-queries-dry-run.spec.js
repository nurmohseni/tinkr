const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {chooseOutputView, runCode} = require('../support/actions')

test.describe('queries and dry runs', () => {
  test('lists the queries a run sent, and says when it sent none', async () => {
    const {page, close} = await launchTinkr()

    try {
      await chooseOutputView(page, 'Queries')
      await expect(page.getByText('Run the snippet to see the queries it sends.')).toBeVisible()

      await runCode(page, "DB::select('select * from orders where paid = ?', [1]);")

      // the run brought the Output view forward; the query log is a click away
      await expect(page.getByRole('tablist', {name: 'Output views'}).locator('label').filter({hasText: 'Queries'})).toHaveAttribute('title', 'Queries, 1 sent')

      await chooseOutputView(page, 'Queries')

      const queries = page.locator('.output table.qtable')

      await expect(queries).toBeVisible()
      await expect(queries.locator('thead')).toContainText('sql')
      await expect(queries.locator('thead')).toContainText('bindings')
      await expect(queries.locator('thead')).toContainText('connection')
      await expect(queries.locator('tbody tr')).toHaveCount(1)
      await expect(queries.locator('tbody')).toContainText('select * from orders where paid = ?')
      await expect(queries.locator('tbody')).toContainText('[1]')
      await expect(queries.locator('tbody')).toContainText('fixture')

      await runCode(page, '1 + 1;')
      await chooseOutputView(page, 'Queries')
      await expect(page.getByText('The run sent no query.')).toBeVisible()
    } finally {
      await close()
    }
  })

  test('rolls a dry run back, offers to keep it, and commits the second run', async () => {
    const {page, close} = await launchTinkr()

    try {
      const dry = page.locator('.tabbar button[aria-pressed]')

      await dry.click()
      await expect(dry).toHaveAttribute('aria-pressed', 'true')

      await runCode(page, "DB::update('update orders set paid = 1 where id = 1');")

      const guard = page.locator('.output .guard')

      await expect(guard).toContainText('Rolled back 1 statement on fixture')
      await expect(guard.getByRole('button', {name: 'Run again and keep'})).toBeVisible()

      await guard.getByRole('button', {name: 'Run again and keep'}).click()

      await expect(page.locator('.output .guard')).toContainText('Committed 1 statement on fixture', {timeout: 60_000})
      await expect(page.locator('.output .guard').getByRole('button', {name: 'Run again and keep'})).toHaveCount(0)
    } finally {
      await close()
    }
  })

  test('runs a dry run read as it would have run', async () => {
    const {page, close} = await launchTinkr()

    try {
      await page.locator('.tabbar button[aria-pressed]').click()
      await runCode(page, 'Order::count();')

      await expect(page.locator('.output')).toContainText('3')
      // a read is not something the guard held: the select is what the
      // transaction carried, and there is nothing to keep
      await expect(page.locator('.output .guard')).toContainText('Rolled back 1 statement on fixture')
      await expect(page.locator('.output .guard').getByRole('button', {name: 'Run again and keep'})).toHaveCount(0)
    } finally {
      await close()
    }
  })
})
