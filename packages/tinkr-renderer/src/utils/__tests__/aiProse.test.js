import {parseInline, parseProse} from '../aiProse'

describe('an answer as the blocks it was written in', () => {
  test('a paragraph keeps the lines the model broke it into', () => {
    expect(parseProse('one idea\nanother idea')).toEqual([
      {type: 'paragraph', text: 'one idea\nanother idea'},
    ])
  })

  test('a blank line is what makes a new paragraph', () => {
    expect(parseProse('first\n\n\nsecond')).toEqual([
      {type: 'paragraph', text: 'first'},
      {type: 'paragraph', text: 'second'},
    ])
  })

  test('a carriage return is a line break like any other', () => {
    expect(parseProse('first\r\n\r\nsecond')).toEqual([
      {type: 'paragraph', text: 'first'},
      {type: 'paragraph', text: 'second'},
    ])
  })

  test('bullets and numbers are lists, each of its own kind', () => {
    expect(parseProse('- one\n- two\n\n1. first\n2. second')).toEqual([
      {type: 'list', ordered: false, items: ['one', 'two']},
      {type: 'list', ordered: true, items: ['first', 'second']},
    ])
  })

  test('an indented line under an item is still that item', () => {
    const [list] = parseProse('- a sentence that\n  runs on\n- another')

    expect(list.items).toEqual(['a sentence that runs on', 'another'])
  })

  test('a paragraph after a list ends the list', () => {
    expect(parseProse('- one\nafter')).toEqual([
      {type: 'list', ordered: false, items: ['one']},
      {type: 'paragraph', text: 'after'},
    ])
  })

  test('a heading says how deep it is, without the hashes that closed it', () => {
    expect(parseProse('## What it does ##')).toEqual([
      {type: 'heading', level: 2, text: 'What it does'},
    ])
  })

  test('a fenced block is code, with the language it was written as', () => {
    expect(parseProse('before\n```php\n$a = 1;\n```\nafter')).toEqual([
      {type: 'paragraph', text: 'before'},
      {type: 'code', language: 'php', code: '$a = 1;'},
      {type: 'paragraph', text: 'after'},
    ])
  })

  test('a fence that was never closed is code as far as the answer got', () => {
    expect(parseProse('```php\n$a = 1;')).toEqual([
      {type: 'code', language: 'php', code: '$a = 1;'},
    ])
  })

  test('a blank line inside a block is code, not a paragraph break', () => {
    const [block] = parseProse('```\none\n\ntwo\n```')

    expect(block.code).toBe('one\n\ntwo')
  })

  test('an empty answer is no block at all', () => {
    expect(parseProse('')).toEqual([])
    expect(parseProse(null)).toEqual([])
  })
})

describe('the words of one line', () => {
  test('a backticked word is code', () => {
    expect(parseInline('run `$a` now')).toEqual([
      {type: 'text', text: 'run '},
      {type: 'code', text: '$a'},
      {type: 'text', text: ' now'},
    ])
  })

  test('a doubled asterisk is weight', () => {
    expect(parseInline('**careful**')).toEqual([{type: 'strong', text: 'careful'}])
  })

  test('a single asterisk is arithmetic', () => {
    expect(parseInline('$a * $b')).toEqual([{type: 'text', text: '$a * $b'}])
  })

  test('a mark that was never closed is what it is', () => {
    expect(parseInline('an `unclosed span')).toEqual([{type: 'text', text: 'an `unclosed span'}])
  })

  test('a backtick inside weight is left for the weight to show', () => {
    expect(parseInline('**`$a`**')).toEqual([{type: 'strong', text: '`$a`'}])
  })

  test('a backtick does not run across a line break', () => {
    expect(parseInline('`one\ntwo`')).toEqual([{type: 'text', text: '`one\ntwo`'}])
  })
})
