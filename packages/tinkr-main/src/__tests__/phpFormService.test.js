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

describe('a snippet written with the spaces an editor may insert', () => {
  // the bug this waits against: U+00A0 is inside the byte range php's own
  // identifier rule names, and it is not a name character. A snippet holding one
  // between a name and its `=` gave a field called `$field_name ` — a name that
  // matched no assignment when the form was written back, so the run threw a
  // ParseError on the statement it had just touched
  const nbsp = '\u00a0'
  const code = [
    '<?php',
    `$field_name${nbsp}=${nbsp}'bob';`,
    `$field_qty${nbsp}=${nbsp}3;`,
    'return [$field_name, $field_qty];',
  ].join('\n')

  test('reads the name without the space that is not part of it', async () => {
    const fields = await parsePhpForm('conn', code)

    expect(fields.map(field => field.name)).toEqual(['$field_name', '$field_qty'])
  })

  test('writes the form back into the statement, and it parses', async () => {
    const fields = await parsePhpForm('conn', code)
    const written = await stringifyPhpForm(
      fields.map(field => (field.name === '$field_name' ? Object.assign({}, field, {value: 'alice'}) : field)),
      code,
    )

    // the value is replaced, and the statement still opens with its own name —
    // the space before the `=` is the snippet's and is left as it was; the one
    // after it is the writer's, and is a plain space
    expect(written).toContain('$field_name'.replace(' ', '') + '\u00a0= \'alice\';')
    expect(written).toContain('$field_qty\u00a0= 3;')
  })
})
