jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp'}}))
jest.mock('electron-store', () => class Store {
  get(key, fallback) { return fallback }
})
jest.mock('../processes', () => ({
  getBackgroundPtyProcess: () => null,
  getEditorConnection: () => undefined,
}))

const {phpLiteral, writeFields} = require('../phpLiteral')
const {readForm} = require('../phpForm')

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
    const fields = readForm('$field_n = 3;\n$field_b = true;\n$field_z = null;', 'field_')

    expect(fields.map(field => [field.name, field.value])).toEqual([
      ['$field_n', '3'],
      ['$field_b', 'true'],
      // a null is an empty field, and it is written back as `null`
      ['$field_z', ''],
    ])

    // what a field was read as travels with it, so writing it back keeps it
    expect(fields.map(field => field.literal)).toEqual(['number', 'boolean', 'null'])
  })

  test('reads the variables a snippet declares, whatever php it is written in', () => {
    // the bug this waits against: php-form was a PHP 7 parser, and every
    // construct php added after it — this snippet has four — was a syntax error
    // that took the whole form down
    const code = [
      '<?php',
      "$field_name = 'bob';",
      '$field_user = User::find(1);',
      '$field_kind = match ($field_name) { "bob" => 1, default => 2 };',
      'return $field_user?->posts()->map(fn ($post) => $post->title);',
      'enum Suit: string { case Hearts = "h"; }',
    ].join('\n')

    expect(readForm(code, 'field_')).toEqual([
      {name: '$field_name', value: 'bob'},
      {name: '$field_user', value: 'User::find(1)', literal: 'code'},
      {name: '$field_kind', value: 'match ($field_name) { "bob" => 1, default => 2 }', literal: 'code'},
    ])
  })

  test('reads a field that declares how it is drawn', () => {
    const code = [
      '<?php',
      '$field_email = [',
      "  'label' => 'Email',",
      "  'value' => 'user1@example.com',",
      "  'type' => 'select',",
      "  'options' => [['value' => 'a', 'label' => 'A']],",
      '];',
    ].join('\n')

    expect(readForm(code, 'field_')).toEqual([{
      name: '$field_email',
      value: 'user1@example.com',
      label: 'Email',
      type: 'select',
      options: [{value: 'a', label: 'A'}],
    }])
  })

  test('reads only the snippet own variables, and only once', () => {
    const code = [
      '<?php',
      'function inner() { $field_no = 1; }',
      '// $field_also_no = 2;',
      "$field_s = 'a;b';",
      '$field_s = 2;',
      '$other = 3;',
    ].join('\n')

    // a function body and a comment are not the snippet's own variables, a `;`
    // inside a string ends nothing, and the last assignment is the one that runs
    expect(readForm(code, 'field_')).toEqual([
      {name: '$field_s', value: '2', literal: 'number'},
    ])
  })

  test('keeps a value that is more than one token as the code it is', () => {
    const code = [
      '<?php',
      '$field_cb = function () { return 1; };',
      '$field_list = [1, 2, 3];',
      '$field_arrow = fn ($a) => $a->id;',
    ].join('\n')

    expect(readForm(code, 'field_')).toEqual([
      {name: '$field_cb', value: 'function () { return 1; }', literal: 'code'},
      {name: '$field_list', value: '[1, 2, 3]', literal: 'code'},
      {name: '$field_arrow', value: 'fn ($a) => $a->id', literal: 'code'},
    ])
  })
})

describe('the form of a snippet', () => {
  test('is the code it was read from, with its fields written back into it', async () => {
    const {DynamicPhpForm} = require('../dynamicPhpForm')
    const form = new DynamicPhpForm()
    const code = "$field_name = 'bob';\n$field_qty = 3;\nreturn [$field_name, $field_qty];"

    const fields = await form.parse('one', code)

    expect(form.stringify(fields.map(field => (field.name === '$field_name'
      ? Object.assign({}, field, {value: "alice'"})
      : field)))).toBe(
      "$field_name = 'alice\\'';\n$field_qty = 3;\nreturn [$field_name, $field_qty];",
    )
  })
})

describe('a form read from a snippet php-form could not read', () => {
  test('reads a nullsafe, a match and an enum, which are the constructs it refused', () => {
    // every one of these was `syntax error: unexpected ...` to the PHP 7 parser
    const code = [
      '<?php',
      "$field_name = 'bob';",
      '$field_rank = match ($field_name) { "bob" => 1, default => 2 };',
      'return $user?->posts()->map(fn ($post) => $post->title) ?? [];',
      'enum Suit: string { case Hearts = "h"; }',
    ].join('\n')

    expect(readForm(code, 'field_')).toEqual([
      {name: '$field_name', value: 'bob'},
      {name: '$field_rank', value: 'match ($field_name) { "bob" => 1, default => 2 }', literal: 'code'},
    ])
  })

  test('reads named arguments, a union type and a promoted property', () => {
    const code = [
      '<?php',
      "$field_pad = str_pad('x', width: 3);",
      'function f(int|string $a): static { return new static; }',
    ].join('\n')

    expect(readForm(code, 'field_')).toEqual([
      {name: '$field_pad', value: "str_pad('x', width: 3)", literal: 'code'},
    ])
  })

  test('keeps the value as the code it is, so writing it back does not quote it', () => {
    const code = '$field_user = User::find(1);'
    const fields = readForm(code, 'field_')

    expect(writeFields(code, fields)).toBe(code)
  })

  test('writes a number back as a number and a null back as null', () => {
    const code = '$field_n = 3;\n$field_z = null;'
    const fields = readForm(code, 'field_')

    expect(writeFields(code, fields.map(field => (field.name === '$field_n'
      ? Object.assign({}, field, {value: '7'})
      : field)))).toBe('$field_n = 7;\n$field_z = null;')
  })
})
