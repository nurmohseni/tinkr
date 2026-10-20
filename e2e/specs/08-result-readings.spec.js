const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {runCode} = require('../support/actions')

const reading = async (page, name) => {
  await page.getByRole('radiogroup', {name: 'How to read the result'}).getByText(name, {exact: true}).click()
}

test.describe('reading a result', () => {
  test('reads a list of records as a table, a graph and raw json', async () => {
    const {page, close} = await launchTinkr()

    try {
      // the short name is not in the snippet: the app's class index resolves it
      // to the fixture's model before the run
      await runCode(page, 'Order::all();')

      const output = page.locator('.output')

      await expect(output).toContainText('3 items')
      await expect(output).toContainText('imported')
      await expect(output).toContainText('Order')
      await expect(output).toContainText('App\\Models\\Order')

      await reading(page, 'table')

      const table = output.locator('.result-table table.qtable')

      await expect(table).toBeVisible()
      await expect(table.locator('thead')).toContainText('id')
      await expect(table.locator('thead')).toContainText('customer')
      await expect(table.locator('thead')).toContainText('total')
      await expect(table.locator('thead')).toContainText('paid')
      await expect(table.locator('tbody tr')).toHaveCount(3)
      await expect(table).toContainText('Ada')
      await expect(table).toContainText('Grace')

      await reading(page, 'graph')
      await expect(output.locator('svg.graph__canvas')).toBeVisible()
      await expect(output.locator('svg.graph__canvas')).toContainText('Ada')

      await reading(page, 'raw')
      await expect(output.locator('pre.printed')).toContainText('"customer": "Ada"')

      await reading(page, 'organized')
      await expect(output.locator('.tree')).toBeVisible()
    } finally {
      await close()
    }
  })

  test('draws markup as a document in a sandboxed frame', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, "'<h1>Hello fixture</h1>'")

      await reading(page, 'html')

      const frame = page.frameLocator('iframe.html-view__frame')

      await expect(frame.locator('h1')).toHaveText('Hello fixture')
      await expect(page.locator('iframe.html-view__frame')).toHaveAttribute('sandbox', 'allow-scripts')
    } finally {
      await close()
    }
  })

  test('cuts a long string until it is asked for whole', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, "str_repeat('x', 2500);")

      const output = page.locator('.output')

      await expect(output.locator('.tree__more')).toHaveCount(1)

      await output.locator('.tree__more').click()
      await expect(output.locator('.tree__more')).toHaveCount(0)
    } finally {
      await close()
    }
  })

  test('keeps a value the json encoder cannot carry from becoming a null', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, 'new \\stdClass();')

      await expect(page.locator('.output')).toContainText('object')
      await expect(page.locator('.output')).toContainText('0 keys')
    } finally {
      await close()
    }
  })
})
