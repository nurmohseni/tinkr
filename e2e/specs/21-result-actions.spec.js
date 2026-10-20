const fs = require('fs')
const os = require('os')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {chooseOutputView, runCode} = require('../support/actions')

const clipboard = app => app.evaluate(({clipboard: system}) => system.readText())

const reading = async (page, name) => {
  await page.getByRole('radiogroup', {name: 'How to read the result'}).getByText(name, {exact: true}).click()
}

test.describe('copying and saving a result', () => {
  test('copies a value, a row, a whole CSV and writes the CSV to disk', async () => {
    const {app, page, close} = await launchTinkr()

    const file = path.join(os.tmpdir(), `tinkr-e2e-result-${process.pid}-${Date.now()}.csv`)

    try {
      await page.bringToFront()
      await runCode(page, 'Order::all();')

      await reading(page, 'organized')
      await page.locator('.output .result-summary__actions').getByRole('button', {name: 'Copy'}).click()

      await expect.poll(async () => {
        try {
          return JSON.parse(await clipboard(app))[0].customer
        } catch (e) {
          return null
        }
      }).toBe('Ada')

      await reading(page, 'table')

      const csv = page.locator('.output').getByRole('button', {name: 'CSV'})

      await csv.click()
      await page.getByRole('menu', {name: 'CSV'}).getByRole('menuitem', {name: 'Copy CSV'}).click()

      await expect.poll(() => clipboard(app)).toContain('Ada')
      expect(await clipboard(app)).toContain('customer')

      // the save dialog is the platform's, so its answer is what the main
      // process is given; the write itself is the app's
      await app.evaluate(({dialog}, target) => {
        dialog.showSaveDialogSync = () => target
      }, file)

      await csv.click()
      await page.getByRole('menu', {name: 'CSV'}).getByRole('menuitem', {name: /Save CSV/}).click()

      await expect.poll(() => fs.existsSync(file)).toBe(true)

      const written = fs.readFileSync(file, 'utf8')

      expect(written).toContain('customer')
      expect(written).toContain('Ada')

      await page.getByRole('button', {name: 'Actions for row 0'}).click()
      await page.getByRole('menu', {name: 'Actions for row 0'})
        .getByRole('menuitem', {name: 'Copy row as JSON'})
        .click()

      await expect.poll(async () => {
        try {
          return JSON.parse(await clipboard(app)).customer
        } catch (e) {
          return null
        }
      }).toBe('Ada')
    } finally {
      fs.rmSync(file, {force: true})
      await close()
    }
  })

  test('copies the queries a run sent', async () => {
    const {app, page, close} = await launchTinkr()

    try {
      await page.bringToFront()
      await runCode(page, "DB::select('select * from orders where paid = ?', [1]);")
      await chooseOutputView(page, 'Queries')

      const queries = page.locator('.output')

      await queries.getByRole('button', {name: 'Copy SQL'}).click()

      // the write is a promise the renderer does not await; the clipboard is
      // read once it has landed
      await expect.poll(() => clipboard(app)).toContain('select * from orders where paid = ?')

      await page.getByRole('button', {name: 'Actions for query 1'}).click()
      await page.getByRole('menu', {name: 'Actions for query 1'})
        .getByRole('menuitem', {name: 'Copy SQL'})
        .click()

      await expect.poll(() => clipboard(app)).toContain('select * from orders where paid = ?')
    } finally {
      await close()
    }
  })
})
