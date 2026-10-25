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
    } finally {
      await close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })

  test('keeps paging older entries while a level filter hides most of them', async () => {
    const project = copyFixture()
    const large = path.join(project, 'storage', 'logs', 'sparse.log')
    // one warning every hundred entries: the newest page holds a handful, which
    // is shorter than the pane, so the list has to be filled from older pages
    const line = index => `[2026-10-20 10:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}] local.${index % 100 === 0 ? 'WARNING' : 'INFO'}: entry ${index}\n`

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

      const lowest = async () => Math.min(...((await body.innerText()).match(/entry \d+/g) || [])
        .map(number => Number(number.slice(6))))

      // the matches of the newest page alone reach back a few hundred entries;
      // older matches are only there if older pages were read under the filter
      await expect(logs.locator('.logs__foot')).toContainText('before the end')
      await expect.poll(lowest).toBeLessThan(4000)

      const low = await lowest()

      // and the top edge still reads the page before, as it does unfiltered
      await body.evaluate(list => { list.scrollTop = 0 })

      await expect.poll(lowest).toBeLessThan(low)
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

      const lowest = async () => Math.min(...((await body.innerText()).match(/entry \d+/g) || [])
        .map(number => Number(number.slice(6))))

      let low = await lowest()

      // the top edge is the trigger; the page it reads is joined above, and the
      // entry that was under the eye stays where it was
      for (let at = 0; at < 5; at++) {
        await body.evaluate(list => { list.scrollTop = 0 })
        await expect.poll(lowest).toBeLessThan(low)
        low = await lowest()
      }

      // the cap has dropped the newest page by now, so the list is not at the end
      await expect(logs.locator('.logs__foot')).toContainText('before the end')
      await expect(body).not.toContainText('entry 4999')

      // the bottom edge reads the page after the held end, and the newest entry
      // comes back
      await body.evaluate(list => { list.scrollTop = list.scrollHeight })
      await expect(logs.locator('.logs__foot')).toContainText('read the last', {timeout: 15_000})
      await expect(body).toContainText('entry 4999')
    } finally {
      await close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })
})
