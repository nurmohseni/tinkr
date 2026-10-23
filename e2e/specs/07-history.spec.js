const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {runCode} = require('../support/actions')

const historyFile = profile => path.join(profile, 'Electron', 'app', 'history', 'fixture.json')

test.describe('history', () => {
  test('lists the runs newest first, with the outcome and the first line', async () => {
    const {page, profile, close} = await launchTinkr()

    try {
      await runCode(page, '1 + 1;')
      await runCode(page, '2 + 2;')

      const history = page.getByRole('navigation', {name: 'History'})
      const rows = history.locator('.tree-nav__row--run')

      await expect(rows).toHaveCount(2)
      await expect(rows.nth(0)).toContainText('2 + 2;')
      await expect(rows.nth(1)).toContainText('1 + 1;')
      await expect(rows.nth(0)).toContainText('returned')
      await expect(history).toContainText('2 today')

      const stored = JSON.parse(fs.readFileSync(historyFile(profile), 'utf8')).entries

      expect(stored).toHaveLength(2)
      expect(stored[0].code).toBe('2 + 2;')
      expect(stored[0].outcome).toBe('returned')
      expect(stored[0].value).toBe(4)
      expect(stored[0].at).toBeGreaterThan(0)
      expect(stored[1].code).toBe('1 + 1;')
    } finally {
      await close()
    }
  })

  test('opens a run in a new tab, with the code it ran', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, '6 * 7;')

      const row = page.getByRole('navigation', {name: 'History'}).locator('.tree-nav__row--run').first()

      expect(await row.getAttribute('title')).toContain('Open this run')
      await row.click()

      await expect(page.getByRole('tab')).toHaveCount(2)
      await expect(page.getByRole('tab').nth(1)).toHaveAttribute('title', /\d/)
      // the code arrived in the well but was not run again: the run in the pane
      // is the one this session did not make
      await expect(page.locator('.output')).not.toContainText('returned')

      await page.locator('.tabbar .btn--run').first().click()
      await expect(page.locator('.output')).toContainText('42', {timeout: 60_000})

      // running it again from the new tab is the same code as the latest run, so
      // the ledger keeps the first run of it and adds nothing
      await expect(page.getByRole('navigation', {name: 'History'}).locator('.tree-nav__row--run')).toHaveCount(1)
    } finally {
      await close()
    }
  })

  test('clears the ledger only after asking, and forgets it on disk', async () => {
    const {page, profile, close} = await launchTinkr()

    try {
      await runCode(page, '1 + 1;')

      const history = page.getByRole('navigation', {name: 'History'})

      await history.getByRole('button', {name: 'Clear history'}).click()

      let dialog = page.getByRole('dialog')

      await expect(dialog).toContainText('Forget this connection')
      await dialog.getByRole('button', {name: 'Cancel'}).click()
      await expect(history).toContainText('1 + 1;')

      await history.getByRole('button', {name: 'Clear history'}).click()
      dialog = page.getByRole('dialog')
      await dialog.getByRole('button', {name: 'Clear history'}).click()

      await expect(history).toContainText('No runs yet')

      const stored = JSON.parse(fs.readFileSync(historyFile(profile), 'utf8'))

      expect(stored.entries).toEqual([])
    } finally {
      await close()
    }
  })

  test('keeps a connection\'s history across a restart', async () => {
    const first = await launchTinkr({}, {keepProfile: true})

    await runCode(first.page, '40 + 2;')
    await first.close()

    const second = await launchTinkr({}, {profile: first.profile, keepProfile: true})

    try {
      const history = second.page.getByRole('navigation', {name: 'History'})

      await expect(history).toContainText('40 + 2;')
      await expect(history).toContainText('returned')
      await expect(history).toContainText('1 today')
    } finally {
      await second.close()
    }
  })
})
