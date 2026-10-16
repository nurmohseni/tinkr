import {toPhpArray} from '../phpArray'

describe('test toPhpArray', () => {
  test('should write a record whose keys are names as an array of pairs', () => {
    expect(toPhpArray({name: 'Tinkr', version: 5})).toBe([
      '[',
      "    'name' => 'Tinkr',",
      "    'version' => 5,",
      ']',
    ].join('\n'))
  })

  test('should write a list of records as a list, and keep the keys of a row inside it', () => {
    expect(toPhpArray([{id: 1}, {id: 2}])).toBe([
      '[',
      '    [',
      "        'id' => 1,",
      '    ],',
      '    [',
      "        'id' => 2,",
      '    ],',
      ']',
    ].join('\n'))
  })

  test('should write a list of values without their keys', () => {
    expect(toPhpArray(['a', 'b'])).toBe("[\n    'a',\n    'b',\n]")
  })

  test('should keep the keys of a list whose keys are not one after another', () => {
    expect(toPhpArray({2: 'a', 3: 'b'})).toBe("[\n    2 => 'a',\n    3 => 'b',\n]")
  })

  test('should quote a key php would not read as an integer', () => {
    const value = {'first name': 'Ada'}

    // a key that looks like a number and is not one, which is how php reads it:
    // written as a member so the linter does not helpfully unquote the literal
    value['1.5'] = 'x'

    expect(toPhpArray(value)).toBe("[\n    'first name' => 'Ada',\n    '1.5' => 'x',\n]")
  })

  test('should escape what would end a string early', () => {
    expect(toPhpArray({name: "O'Brien", path: 'App\\Models'})).toBe([
      '[',
      "    'name' => 'O\\'Brien',",
      "    'path' => 'App\\\\Models',",
      ']',
    ].join('\n'))
  })

  test('should write the values php has words for', () => {
    expect(toPhpArray({ok: true, no: false, none: null, float: 1.5}))
      .toBe("[\n    'ok' => true,\n    'no' => false,\n    'none' => null,\n    'float' => 1.5,\n]")
  })

  test('should write an empty list as an empty array, and an empty array the same', () => {
    expect(toPhpArray([])).toBe('[]')
    expect(toPhpArray({})).toBe('[]')
  })

  test('should indent a value nested inside another one', () => {
    expect(toPhpArray({meta: {depth: 2}})).toBe([
      '[',
      "    'meta' => [",
      "        'depth' => 2,",
      '    ],',
      ']',
    ].join('\n'))
  })
})
