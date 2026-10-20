const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {chooseOutputView, outputText, runCode, setEditorCode} = require('../support/actions')

test.describe('running a snippet', () => {
  test('returns a value, shows the duration and brings the output view forward', async () => {
    const {page, close, errors} = await launchTinkr()

    try {
      // start from another view: a run is what the person is waiting for, so it
      // is brought in front rather than left behind the view that was open
      await chooseOutputView(page, 'Queries')

      await runCode(page, '1 + 1;')

      await expect(page.getByRole('radio', {name: 'Output'})).toBeChecked()
      await expect(page.locator('.output')).toContainText('returned')
      await expect(page.locator('.output')).toContainText('a number')
      await expect(page.locator('.t-number').first()).toHaveText('2')
      await expect(page.locator('.result-summary__duration')).toHaveText(/<0\.1s|\d+(\.\d+)?s/)

      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })

  test('reads a run of several statements one by one', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, '$a = 2;\n$b = 3;\n$a + $b;')

      const output = page.locator('.output')

      await expect(output).toContainText('3 statements')
      await expect(output).toContainText('Line 1')
      await expect(output).toContainText('Line 2')
      await expect(output).toContainText('Line 3')
      await expect(output.locator('.block__line')).toHaveCount(3)
      await expect(output.locator('.t-number').filter({hasText: '5'})).toHaveCount(1)
    } finally {
      await close()
    }
  })

  test('shows a thrown exception and says so in the status bar', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, "throw new \\RuntimeException('fixture exploded');")

      await expect(page.locator('.error-surface__class')).toHaveText('RuntimeException')
      await expect(page.locator('.error-surface__message')).toContainText('fixture exploded')
      await expect(page.locator('.statusbar')).toContainText('Run failed · RuntimeException')
      await expect(page.locator('.output')).toContainText('no value returned')
    } finally {
      await close()
    }
  })

  test('shows what the run printed when it returned nothing', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, "echo 'printed from the fixture';")

      const output = page.locator('.output')

      await expect(output).toContainText('printed')
      await expect(page.locator('.output pre.printed')).toContainText('printed from the fixture')
    } finally {
      await close()
    }
  })

  test('says nothing was returned when nothing was', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, 'unset($nothing);')

      await expect(page.getByText('This snippet did not return a value.')).toBeVisible()
      await expect(page.getByText('It printed nothing either.')).toBeVisible()
    } finally {
      await close()
    }
  })

  test('runs from the Ctrl+R binding', async () => {
    const {page, close} = await launchTinkr()

    try {
      await setEditorCode(page, '21 * 2;')
      await page.keyboard.press('Control+r')

      await expect(page.locator('.output')).toContainText('42', {timeout: 60_000})
      await expect(page.locator('.tabbar .btn--run').first()).not.toHaveClass(/btn--danger/)
    } finally {
      await close()
    }
  })

  test('stops a run that is going, and keeps the pane as it was', async () => {
    const {page, close} = await launchTinkr()

    try {
      const button = page.locator('.tabbar .btn--run').first()

      await setEditorCode(page, 'sleep(30);')
      await button.click()
      await expect(button).toHaveClass(/btn--danger/, {timeout: 10_000})

      await button.click()

      await expect(button).not.toHaveClass(/btn--danger/)
      await expect(page.locator('.result-summary')).toHaveCount(0)
      await expect(page.locator('.output')).not.toContainText('returned')
    } finally {
      await close()
    }
  })

  test('reconnects the session from the output panel', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, '1 + 1;')
      await expect(page.locator('.output .t-number').first()).toHaveText('2')

      await page.getByRole('button', {name: 'Reconnect'}).click()
      await page.waitForTimeout(500)

      await runCode(page, '2 + 2;')
      await expect(page.locator('.output .t-number').first()).toHaveText('4')
    } finally {
      await close()
    }
  })

  test('gives up on a run that outlives the preference, and says so', async () => {
    const {page, close} = await launchTinkr({config: {run_timeout: 1200}})

    try {
      await setEditorCode(page, 'sleep(5);')
      await page.locator('.tabbar .btn--run').first().click()

      await expect(page.locator('.error-surface__class')).toHaveText('Timeout', {timeout: 20_000})
      await expect(page.locator('.error-surface__message')).toContainText('stopped after 1200ms')
      await expect(page.locator('.statusbar')).toContainText('Run failed · Timeout')
    } finally {
      await close()
    }
  })
})
