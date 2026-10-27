const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {copyFixture, fixture, fixtureConnection, launchTinkr} = require('../support/tinkr')

const openLogs = async (app, page) => {
  const [logs] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', {name: 'Logs'}).click(),
  ])

  await logs.locator('.logs').waitFor({state: 'visible'})

  return logs
}

const pickFile = async (logs, name) => {
  await logs.getByTitle(name).click()
}

test.describe('the log viewer', () => {
  test('lists the project\'s log files and reads the newest entries', async () => {
    const {app, page, close} = await launchTinkr()

    try {
      const logs = await openLogs(app, page)

      const rail = logs.getByRole('navigation', {name: 'Log files'})

      await expect(rail).toContainText('laravel')
      await expect(rail).toContainText('worker')
      await expect(logs.locator('.logs__dir')).toContainText(path.join(fixture, 'storage', 'logs'))

      await pickFile(logs, 'laravel.log')

      const entries = logs.locator('details.log')

      await expect(entries).toHaveCount(6)
      await expect(logs.locator('.logs__body')).toContainText('fixture booted')
      await expect(logs.locator('.logs__body')).toContainText('slow query detected')
      await expect(logs.locator('.logs__body')).toContainText('fixture failure')

      // the stack trace belongs to the error above it, and is opened with it
      await expect(logs.locator('details.log').filter({hasText: 'fixture failure'})).toContainText('RuntimeException: boom')

      await pickFile(logs, 'worker.log')
      await expect(logs.locator('.logs__body')).toContainText('queue worker started')
      await expect(logs.locator('.logs__body')).toContainText('retrying job')
    } finally {
      await close()
    }
  })

  test('filters by level, by a search term and by a time range', async () => {
    const {app, page, close} = await launchTinkr()

    try {
      const logs = await openLogs(app, page)

      await pickFile(logs, 'laravel.log')

      const body = logs.locator('.logs__body')

      // the search reads the whole entry, details included
      await logs.getByRole('searchbox', {name: 'Search the entries'}).fill('slow query')
      await expect(body).toContainText('slow query detected')
      await expect(body).not.toContainText('fixture failure')
      await logs.getByRole('searchbox', {name: 'Search the entries'}).fill('')

      await logs.getByRole('button', {name: 'Filter'}).click()

      const filter = logs.getByRole('group', {name: 'Filter'})

      await expect(filter).toBeVisible()
      await filter.getByLabel('debug', {exact: true}).uncheck()
      await filter.getByLabel('warning', {exact: true}).uncheck()

      await expect(body).toContainText('fixture booted')
      await expect(body).not.toContainText('slow query detected')
      await expect(body).toContainText('fixture failure')
      await expect(body).toContainText('daily job finished')

      // the range is read out of the file, and the warning is back in so the
      // range is what decides
      await filter.getByLabel('warning', {exact: true}).check()
      await filter.getByLabel('from').fill('2026-10-18T00:00')
      await filter.getByLabel('to').fill('2026-10-19T23:59')
      await filter.getByRole('button', {name: 'Apply'}).click()

      await expect(body).toContainText('fixture booted')
      await expect(body).toContainText('slow query detected')
      await expect(body).not.toContainText('daily job finished')

      await logs.getByRole('button', {name: 'Filter'}).click()
      const emptyRange = logs.getByRole('group', {name: 'Filter'})
      await emptyRange.getByLabel('to').fill('')
      await emptyRange.getByLabel('from').fill('2027-01-01T00:00')
      await emptyRange.getByRole('button', {name: 'Apply'}).click()
      await expect(logs.locator('.logs__body')).toHaveAttribute('aria-busy', 'false')
      await expect(logs.locator('details.log')).toHaveCount(0)

      await logs.getByRole('button', {name: 'Filter'}).click()
      await logs.getByRole('group', {name: 'Filter'}).getByRole('button', {name: 'Whole file'}).click()
      await logs.getByRole('button', {name: 'Filter'}).click()
      await logs.getByRole('group', {name: 'Filter'}).getByLabel('debug', {exact: true}).check()
      await expect(body).toContainText('daily job finished')
    } finally {
      await close()
    }
  })

  test('follows a file while it is written to', async () => {
    const project = copyFixture()
    const {app, page, close} = await launchTinkr({
      connections: [fixtureConnection({path: project})],
    })

    try {
      const logs = await openLogs(app, page)

      await pickFile(logs, 'laravel.log')
      await logs.locator('label.logs__follow .switch__track').click()

      fs.appendFileSync(
        path.join(project, 'storage', 'logs', 'laravel.log'),
        '[2026-10-20 09:30:00] local.INFO: appended while following\n',
      )

      await expect(logs.locator('.logs__body')).toContainText('appended while following', {timeout: 15_000})

      await expect(logs.getByLabel('Follow')).toBeChecked()

      await logs.getByRole('searchbox').fill('appended while following')
      await expect(logs.locator('.log__message')).toHaveText(['appended while following'])

      fs.appendFileSync(
        path.join(project, 'storage', 'logs', 'laravel.log'),
        '[stacktrace]\n#0 continuation appended after the header\n',
      )

      const appended = logs.locator('details.log').filter({hasText: 'appended while following'})
      await expect(appended).toHaveCount(1)
      await expect(appended.locator('pre')).toContainText('continuation appended after the header')
      await appended.locator('summary').click()
      await expect(appended.locator('pre')).toBeVisible()

      await logs.getByRole('searchbox').fill('arriving needle')
      await expect(logs.locator('details.log')).toHaveCount(0)
      fs.appendFileSync(path.join(project, 'storage', 'logs', 'laravel.log'), '#1 arriving needle\n')
      await expect(logs.locator('.log__message')).toHaveText(['appended while following'])
      await expect(logs.locator('.log__details')).toContainText('#1 arriving needle')
    } finally {
      await close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })

  test('finds sparse level and search matches beyond the loaded byte window', async () => {
    const project = copyFixture()
    const large = path.join(project, 'storage', 'logs', 'sparse.log')
    const line = index => `[2026-10-20 10:00:00] local.${index % 100 === 0 ? 'WARNING' : 'INFO'}: entry ${index}\n`

    fs.writeFileSync(large, Array.from({length: 5000}, (unused, index) => line(index)).join(''))

    const {app, page, close} = await launchTinkr({
      connections: [fixtureConnection({path: project})],
    })

    try {
      const logs = await openLogs(app, page)

      await pickFile(logs, 'sparse.log')

      const body = logs.locator('.logs__body')

      await expect(logs.locator('.logs__foot')).toContainText('read the last')

      await logs.getByRole('button', {name: 'Filter', exact: true}).click()

      const filter = logs.getByRole('group', {name: 'Filter'})

      for (const level of ['debug', 'info', 'notice', 'error', 'critical', 'alert', 'emergency']) {
        const box = filter.getByLabel(level, {exact: true})

        if (await box.isChecked()) {
          await box.uncheck()
        }
      }

      await filter.getByLabel('warning', {exact: true}).press('Escape')
      await expect(logs.locator('details.log')).toHaveCount(50)
      await expect(body).toContainText('entry 0')
      await expect(body).toContainText('entry 4900')
      await expect(body).not.toContainText('entry 4999')

      await logs.getByRole('searchbox').fill('entry 100')
      await expect(logs.locator('.log__message')).toHaveText(['entry 100', 'entry 1000'])
      await logs.getByRole('searchbox').fill('does not exist')
      await expect(logs.locator('.logs__body')).toHaveAttribute('aria-busy', 'false')
      await expect(logs.locator('details.log')).toHaveCount(0)
      await logs.getByRole('searchbox').fill('')
      await expect(logs.locator('details.log')).toHaveCount(50)

      await logs.getByRole('button', {name: 'Filter', exact: true}).click()
      await logs.getByRole('group', {name: 'Filter'}).getByLabel('warning', {exact: true}).uncheck()
      await expect(logs.locator('details.log')).toHaveCount(0)
      await logs.getByRole('group', {name: 'Filter'}).getByLabel('warning', {exact: true}).check()
      await expect(logs.locator('details.log')).toHaveCount(50)
    } finally {
      await close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })

  test('loads older pages as the list scrolls, and newer ones on the way back', async () => {
    const project = copyFixture()
    const large = path.join(project, 'storage', 'logs', 'large.log')
    const line = index => `[2026-10-20 10:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}] local.INFO: entry ${index}\n`

    fs.writeFileSync(large, Array.from({length: 5000}, (_, index) => line(index)).join(''))

    const {app, page, close} = await launchTinkr({
      connections: [fixtureConnection({path: project})],
    })

    try {
      const logs = await openLogs(app, page)

      await pickFile(logs, 'large.log')

      const body = logs.locator('.logs__body')

      await expect(logs.locator('.logs__foot')).toContainText('read the last')
      await expect(body).toContainText('entry 4999')

      const step = async side => {
        const before = await body.evaluate((list, direction) => {
          list.scrollTop = direction === 'older' ? 0 : list.scrollHeight
          const top = list.getBoundingClientRect().top
          const row = Array.from(list.querySelectorAll('[data-entry]'))
            .find(one => one.getBoundingClientRect().bottom > top)
          const pages = list.querySelectorAll('[data-page]')

          return {
            from: Number(pages[0].dataset.page),
            to: Number(pages[pages.length - 1].dataset.page),
            key: row.dataset.entry,
            y: row.getBoundingClientRect().top,
          }
        }, side)

        const boundary = () => body.evaluate((list, direction) => {
          const pages = list.querySelectorAll('[data-page]')
          return Number(pages[direction === 'older' ? 0 : pages.length - 1].dataset.page)
        }, side)

        if (side === 'older') {
          await expect.poll(boundary).toBeLessThan(before.from)
        } else {
          await expect.poll(boundary).toBeGreaterThan(before.to)
        }

        const y = await body.locator(`[data-entry="${before.key}"]`).evaluate(row => row.getBoundingClientRect().top)
        expect(Math.abs(y - before.y)).toBeLessThan(1)
        expect(await body.locator('[data-page]').count()).toBeLessThanOrEqual(4)
      }

      for (let at = 0; at < 5; at++) {
        await step('older')
      }

      await expect(body).not.toContainText('entry 4999')

      for (let at = 0; at < 2; at++) {
        await step('newer')
      }

      await expect(body).toContainText('entry 4999')

      // Matching-entry pagination takes the same path with a different cursor
      // width: 100 matches, rather than 32 KB of raw bytes.
      await logs.getByRole('searchbox').fill('entry ')
      await expect(logs.locator('details.log')).toHaveCount(100)

      for (let at = 0; at < 5; at++) {
        await step('older')
      }

      await expect(body).not.toContainText('entry 4999')

      for (let at = 0; at < 2; at++) {
        await step('newer')
      }

      await expect(body).toContainText('entry 4999')

      // Delay the real file read to exercise the direction change an SSH
      // connection can make visible. No log answer is replaced by a mock.
      await app.evaluate(({ipcMain}) => {
        const original = ipcMain._invokeHandlers.get('logRead')
        globalThis.delayedLogReadFinished = false
        ipcMain.removeHandler('logRead')
        ipcMain.handle('logRead', async (...args) => {
          const delayed = args[3].before != null

          if (delayed) {
            await new Promise(resolve => setTimeout(resolve, 600))
          }

          const answer = await original(...args)

          if (delayed) {
            globalThis.delayedLogReadFinished = true
          }

          return answer
        })
      })

      await body.evaluate(list => { list.scrollTop = 0 })
      await expect(body).toHaveAttribute('aria-busy', 'true')
      const returned = await body.evaluate(list => {
        list.scrollTop = list.scrollHeight
        const top = list.getBoundingClientRect().top
        const row = Array.from(list.querySelectorAll('[data-entry]'))
          .find(one => one.getBoundingClientRect().bottom > top)

        return {key: row.dataset.entry, y: row.getBoundingClientRect().top}
      })

      await expect.poll(() => app.evaluate(() => globalThis.delayedLogReadFinished)).toBe(true)
      const returnedY = await body.locator(`[data-entry="${returned.key}"]`)
        .evaluate(row => row.getBoundingClientRect().top)
      expect(Math.abs(returnedY - returned.y)).toBeLessThan(1)
      await expect(body).toContainText('entry 4999')
    } finally {
      await close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })
})
