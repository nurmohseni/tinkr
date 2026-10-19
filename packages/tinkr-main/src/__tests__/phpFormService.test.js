jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp'}}))
jest.mock('electron-store', () => class Store {
  get(key, fallback) { return fallback }
})
jest.mock('../createBackgroundPty', () => ({ensureBackgroundPty: jest.fn()}))

const {ensureBackgroundPty} = require('../createBackgroundPty')
const {parsePhpForm, stringifyPhpForm} = require('../services/php')

/**
 * The service the window's form goes through: what the renderer asks the main
 * process for, by way of `ipc.js`.
 *
 * The reading itself is `phpForm`'s and has its own tests; what is tested here is
 * that this module reaches it — the form used to be a package with a static
 * `instance()`, and when that was replaced by a module of the same name this
 * file kept calling the static, so opening a form failed with
 * `DynamicPhpForm.instance is not a function`.
 */
describe('the form the window asks for', () => {
  beforeEach(() => {
    ensureBackgroundPty.mockClear()
  })

  test('reads the fields of a snippet', async () => {
    const fields = await parsePhpForm('conn', "<?php\n$field_name = 'bob';\n$field_qty = 3;")

    expect(fields).toEqual([
      {name: '$field_name', value: 'bob'},
      {name: '$field_qty', value: '3', literal: 'number'},
    ])
  })

  test('opens the session it asks a closure of, before it reads', async () => {
    await parsePhpForm('conn', '$field_cb = fn () => 1;')

    // a run boots a new session, so the background one the form asks may be gone
    expect(ensureBackgroundPty).toHaveBeenCalledWith('conn')
  })

  // the bug this module had: a form with nothing to show still opened, and a
  // snippet php 8 is written in is the one that used to close it
  test('reads a snippet php 8 is written in', async () => {
    const fields = await parsePhpForm('conn', [
      '<?php',
      "$field_kind = match ('a') { 'a' => 1, default => 2 };",
      'return $user?->posts();',
    ].join('\n'))

    expect(fields.map(field => field.name)).toEqual(['$field_kind'])
  })

  test('writes the form back into the code it came from', async () => {
    const code = "<?php\n$field_name = 'bob';\n$field_qty = 3;\nreturn [$field_name, $field_qty];"
    const fields = await parsePhpForm('conn', code)
    const written = await stringifyPhpForm(
      fields.map(field => (field.name === '$field_name' ? Object.assign({}, field, {value: 'alice'}) : field)),
      code,
    )

    expect(written).toBe("<?php\n$field_name = 'alice';\n$field_qty = 3;\nreturn [$field_name, $field_qty];")
  })

  test('writes into the code it was last given when a form sends none', async () => {
    const code = '$field_a = 1;\nreturn $field_a;'
    const fields = await parsePhpForm('conn', code)

    // the code is kept with the form, so a form sent without it is still the
    // snippet's own form
    expect(await stringifyPhpForm(fields)).toBe(code)
  })
})
