jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp'}}))
jest.mock('electron-store', () => class Store {
  get(key, fallback) { return fallback }
})
jest.mock('php-form', () => ({instance: async () => ({parse: async () => []})}))
jest.mock('../processes', () => ({getBackgroundPtyProcess: () => ({})}))

const {phpLiteral, writeFields} = require('../phpLiteral')

describe('a form value as php source', () => {
  test('is escaped, so what a field holds is a string and never code', () => {
    // the value that used to close the string and run the rest as code
    expect(phpLiteral("'; echo 'INJECTED'; //")).toBe("'\\'; echo \\'INJECTED\\'; //'")
    expect(phpLiteral("O'Brien")).toBe("'O\\'Brien'")
    // a backslash is escaped first, so the quote after it stays a quote
    expect(phpLiteral('C:\\new\\table\\')).toBe("'C:\\\\new\\\\table\\\\'")
    expect(phpLiteral('a\\\'b')).toBe("'a\\\\\\'b'")
  })

  test('keeps what is not a string as what it is', () => {
    expect(phpLiteral(null)).toBe('null')
    expect(phpLiteral(true)).toBe('true')
    expect(phpLiteral(false)).toBe('false')
    expect(phpLiteral(3, 'number')).toBe('3')
    expect(phpLiteral('7', 'integer')).toBe('7')
    // an integer field left empty is nothing, not an empty string
    expect(phpLiteral('', 'integer')).toBe('null')
    expect(phpLiteral('abc', 'number')).toBe("'abc'")
    expect(phpLiteral([1, 2])).toBe('[0 => 1, 1 => 2]')
    expect(phpLiteral({a: 'b'})).toBe("['a' => 'b']")
  })

  test('writes a field into the assignment it came from, and nothing else', () => {
    const code = [
      "$field_name = 'bob';",
      '$field_qty = 3;',
      '// $field_name is used below',
      'return [$field_name, $field_qty];',
    ].join('\n')

    expect(writeFields(code, [
      {name: '$field_name', value: 'alice'},
      {name: '$field_qty', value: '4', type: 'number'},
    ])).toBe([
      "$field_name = 'alice';",
      '$field_qty = 4;',
      '// $field_name is used below',
      'return [$field_name, $field_qty];',
    ].join('\n'))

    // the comment is not a field, and a field the code no longer holds is not
    // appended: a form is the code's own form
    expect(writeFields(code, [{name: '$field_missing', value: 'x'}])).toBe(code)
  })

  test('replaces a value that is more than one token, and one that spans lines', () => {
    const code = [
      '$field_a = function () { return 1; };',
      "$field_b = 'one'",
      "  . 'two';",
      '$field_c = [1, 2, 3];',
      'return $field_a;',
    ].join('\n')

    expect(writeFields(code, [
      {name: '$field_a', value: 'plain'},
      {name: '$field_b', value: 'joined'},
      {name: '$field_c', value: 'kept'},
    ])).toBe([
      "$field_a = 'plain';",
      "$field_b = 'joined';",
      "$field_c = 'kept';",
      'return $field_a;',
    ].join('\n'))
  })

  test('does not end a value at a semicolon inside a string', () => {
    const code = "$field_s = 'a;b'; $field_t = 1;"

    expect(writeFields(code, [{name: '$field_s', value: 'x'}])).toBe("$field_s = 'x'; $field_t = 1;")
  })
})

describe('a form read from a snippet', () => {
  test('shows a value that is not text as the text it reads back as', () => {
    const {DynamicPhpForm} = require('../dynamicPhpForm')
    const form = new DynamicPhpForm({
      parse: async () => [
        {name: '$field_n', value: '3'},
        {name: '$field_b', value: 'true'},
        // a value the parser could not read is not quietly turned into nothing
        {name: '$field_z', value: null},
      ],
    })

    return form.parse('one', '$field_n = 3;').then(fields => {
      expect(fields.map(field => [field.name, field.value])).toEqual([
        ['$field_n', '3'],
        ['$field_b', 'true'],
        ['$field_z', ''],
      ])
    })
  })
})
