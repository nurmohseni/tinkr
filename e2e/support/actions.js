const {expect} = require('@playwright/test')

/**
 * Replace what the well holds, the way typing does: the model is Monaco's, and
 * setting its value behind its back would leave its change events unfired.
 *
 * @param {import('playwright').Page} page
 * @param {String} code
 */
const setEditorCode = async (page, code) => {
  const editor = page.locator('.editor .monaco-editor').first()

  await editor.waitFor({state: 'visible'})
  // the lines are what takes a click inside the editor; the container's edge is
  // the gutter, and a press there leaves the caret where it was
  await editor.locator('.view-lines').first().click()
  await editor.click()

  const surface = page.locator('.editor textarea.inputarea').first()

  if (await surface.count()) {
    await surface.focus()
  }

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(code)
  // the run control reads the model, and a keystroke that never reached it is
  // a run button that stays disabled
  await expect(page.locator('.tabbar .btn--run').first()).toBeEnabled({timeout: 5_000})
    .catch(async () => {
      await editor.locator('.view-lines').first().click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.insertText(code)
    })
}

/**
 * Click Run, and wait until the run is over.
 *
 * The button turns into Stop while the run is going, and back into Run when the
 * answer lands. A run can be quick enough that the stop is never sampled, so
 * the wait is for the answer first and for the button after it.
 *
 * @param {import('playwright').Page} page
 * @param {Object} [options]
 * @param {Boolean} [options.expectResult]
 */
const runEditor = async (page, {expectResult = true} = {}) => {
  const button = page.locator('.tabbar .btn--run').first()

  await expect(button).toBeEnabled()
  await button.click()

  if (expectResult) {
    await expect(page.locator('.output .result-summary, .output .error-surface, .output .empty--benign').first())
      .toBeVisible({timeout: 60_000})
  }

  await expect(button).not.toHaveClass(/btn--danger/, {timeout: 60_000})
}

/**
 * Type code into the well and run it.
 *
 * @param {import('playwright').Page} page
 * @param {String} code
 * @param {Object} [options]
 */
const runCode = async (page, code, options = {}) => {
  await setEditorCode(page, code)

  return runEditor(page, options)
}

/**
 * The output view as a person reads it: the summary line and the reading under
 * it, as text. A tree has the leaves in it, so `1+1` answers `2` somewhere.
 *
 * @param {import('playwright').Page} page
 * @return {Promise<String>}
 */
const outputText = page => page.locator('.output').innerText()

/**
 * Open a connection's dialog from the sidebar's +.
 *
 * @param {import('playwright').Page} page
 */
const openNewConnection = async page => {
  await page.getByRole('navigation', {name: 'Connections'})
    .getByRole('button', {name: 'New Connection'})
    .click()

  await expect(page.getByRole('dialog')).toBeVisible()
}

/**
 * Click a connection in the sidebar by its name.
 *
 * @param {import('playwright').Page} page
 * @param {String} name
 */
const openConnection = async (page, name) => {
  await page.getByRole('navigation', {name: 'Connections'})
    .getByRole('button', {name})
    .click()

  await expect(page.locator('.statusbar')).toContainText(`Connected · ${name}`)
}

/**
 * Choose one of the output panel's views.
 *
 * The input is a radio the app draws as a tab, and its label is what a person
 * presses; the input itself is behind that label.
 *
 * @param {import('playwright').Page} page
 * @param {String} name
 */
const chooseOutputView = async (page, name) => {
  await page.getByRole('tablist', {name: 'Output views'}).getByText(name, {exact: true}).click()
}

/**
 * Choose one of the dialog's four kinds.
 *
 * The kind is a segmented control whose labels repeat words the form's own
 * fields hold (`local` is also a tag), so the control is what is looked in.
 *
 * @param {import('playwright').Page} page
 * @param {String} label
 */
const chooseKind = async (page, label) => {
  await page.getByRole('dialog')
    .locator('.segmented--fill label')
    .filter({hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)})
    .click()
}

module.exports = {
  chooseKind,
  chooseOutputView,
  openConnection,
  openNewConnection,
  outputText,
  runCode,
  runEditor,
  setEditorCode,
}
