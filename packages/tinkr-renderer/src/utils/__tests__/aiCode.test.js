import {codeRows, tokenClass} from '../aiCode'

describe('the colour of a run', () => {
  test('the grammar types become the design classes', () => {
    expect(tokenClass('keyword.php')).toBe('c-keyword')
    expect(tokenClass('constant.php')).toBe('c-const')
    expect(tokenClass('number.float.php')).toBe('c-num')
    expect(tokenClass('string.escape.php')).toBe('c-str')
    expect(tokenClass('comment.php')).toBe('c-comment')
    expect(tokenClass('variable.predefined.php')).toBe('c-var')
    expect(tokenClass('delimiter.bracket.php')).toBe('c-op')
    expect(tokenClass('identifier.php')).toBe('c-fn')
  })

  test('a run that is nothing in particular has no class', () => {
    expect(tokenClass('')).toBe('')
    expect(tokenClass(undefined)).toBe('')
    expect(tokenClass('source.php')).toBe('')
  })
})

describe('a snippet as lines of runs', () => {
  test('every line adds back up to the words it was written with', () => {
    const code = '$a = 1;'
    const rows = codeRows(code, [[
      {offset: 0, type: 'variable.php'},
      {offset: 2, type: ''},
      {offset: 3, type: 'delimiter.php'},
      {offset: 4, type: ''},
      {offset: 5, type: 'number.php'},
      {offset: 6, type: 'delimiter.php'},
    ]])

    expect(rows[0].map(span => span.text).join('')).toBe(code)
    expect(rows[0].map(span => span.className)).toEqual([
      'c-var', '', 'c-op', '', 'c-num', 'c-op',
    ])
  })

  test('a line the tokenizer said nothing about is plain', () => {
    expect(codeRows('one\ntwo', null)).toEqual([
      [{text: 'one', className: ''}],
      [{text: 'two', className: ''}],
    ])
  })

  test('a gap the tokenizer left is still shown', () => {
    const [row] = codeRows('abcdef', [[{offset: 2, type: 'keyword.php'}]])

    expect(row).toEqual([
      {text: 'ab', className: ''},
      {text: 'cdef', className: 'c-keyword'},
    ])
  })

  test('a repeated or out of range offset changes no words', () => {
    const rows = codeRows('ab', [[
      {offset: 0, type: 'number.php'},
      {offset: 0, type: 'keyword.php'},
      {offset: 99, type: 'string.php'},
    ]])

    expect(rows[0].map(span => span.text).join('')).toBe('ab')
  })

  test('an empty snippet is one empty line', () => {
    expect(codeRows('', null)).toEqual([[]])
  })
})
