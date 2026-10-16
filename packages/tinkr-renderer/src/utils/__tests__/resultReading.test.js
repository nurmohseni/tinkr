import {
  cellOf,
  htmlDocument,
  looksLikeHtml,
  readingOf,
  readingsOf,
  scalarClass,
  scalarText,
  tableOf,
  toCsv,
  truncate,
} from '../resultReading'

const users = [
  {id: 1, name: 'Ada', admin: true},
  {id: 2, name: 'Bob'},
]

describe('test tableOf', () => {
  test('should read a list of records as a table, one column per key', () => {
    expect(tableOf(users)).toEqual({
      rows: [
        {id: 1, name: 'Ada', admin: true},
        {id: 2, name: 'Bob'},
      ],
      columns: ['id', 'name', 'admin'],
      shown: [
        {id: 1, name: 'Ada', admin: true},
        {id: 2, name: 'Bob'},
      ],
      more: 0,
    })
  })

  test('should read the columns out of every row, however much they disagree', () => {
    expect(tableOf([{a: 1, b: 2}, {b: 3, c: 4}]).columns).toEqual(['a', 'b', 'c'])
  })

  test('should leave a list of scalars to the tree, which has nothing to line up', () => {
    expect(tableOf([1, 2, 3])).toBeNull()
  })

  test('should leave an object to the tree', () => {
    expect(tableOf({id: 1})).toBeNull()
  })

  test('should leave an empty list to the tree', () => {
    expect(tableOf([])).toBeNull()
  })

  test('should show 500 rows and say how many are left', () => {
    const many = Array.from({length: 502}, (_, index) => ({n: index}))
    const table = tableOf(many)

    expect(table.shown).toHaveLength(500)
    expect(table.more).toBe(2)
    expect(table.rows).toHaveLength(502)
  })
})

describe('test toCsv', () => {
  test('should write the columns as a header row and every row under it', () => {
    expect(toCsv(['id', 'name'], [{id: 1, name: 'Ada'}, {id: 2, name: 'Bob'}]))
      .toBe('id,name\r\n1,Ada\r\n2,Bob\r\n')
  })

  test('should quote what a comma, a quote or a line break makes ambiguous', () => {
    expect(toCsv(['a', 'b'], [{a: 'x,y', b: 'say "hi"'}, {a: 'one\ntwo', b: 'plain'}]))
      .toBe('a,b\r\n"x,y","say ""hi"""\r\n"one\ntwo",plain\r\n')
  })

  test('should leave a cell empty where a row has no such key, or holds nothing', () => {
    expect(toCsv(['a', 'b', 'c'], [{a: 1}, {b: null, c: 3}])).toBe('a,b,c\r\n1,,\r\n,,3\r\n')
  })

  test('should carry every row, not only the ones the table shows', () => {
    const many = Array.from({length: 502}, (_, index) => ({n: index}))

    expect(toCsv(['n'], many).split('\r\n')).toHaveLength(504)
  })
})

describe('test looksLikeHtml', () => {
  test('should see markup in a tag, wherever it starts', () => {
    expect(looksLikeHtml('<p>hello</p>')).toBe(true)
    expect(looksLikeHtml('  <div class="card">hi</div>')).toBe(true)
  })

  test('should see no markup in words, in code, or in a comparison that only looks like a tag', () => {
    expect(looksLikeHtml('a string a run returned')).toBe(false)
    expect(looksLikeHtml('{"id": 1}')).toBe(false)
    expect(looksLikeHtml('if ($a < $b) { dump($a); }')).toBe(false)
    expect(looksLikeHtml('<?php echo config(\'app.name\');')).toBe(false)
  })
})

describe('test htmlDocument', () => {
  test('should pass a document through as it is', () => {
    const document = '<!DOCTYPE html>\n<html><head><title>t</title></head><body>x</body></html>'

    expect(htmlDocument(document)).toBe(document)
  })

  test('should give markup that is only a fragment a page to sit on', () => {
    const rendered = htmlDocument('<p>hi &amp; bye</p>')

    expect(rendered).toContain('<p>hi &amp; bye</p>')
    expect(rendered).toMatch(/^<!doctype html>/i)
  })
})

describe('test readingsOf', () => {
  test('should offer the shape a value has and never the shape it has not', () => {
    expect(readingsOf([users])).toEqual(['organized', 'table', 'graph', 'raw'])
    expect(readingsOf([{app: {name: 'Tinkr'}}])).toEqual(['organized', 'graph', 'raw'])
    expect(readingsOf(['<p>hi</p>'])).toEqual(['organized', 'html', 'raw'])
  })

  test('should offer every shape one of the values has, for a run read as a whole', () => {
    expect(readingsOf([users, '<p>hi</p>', 5])).toEqual(['organized', 'table', 'graph', 'html', 'raw'])
  })

  test('should leave a run that printed and returned nothing to the tree and the print', () => {
    expect(readingsOf(['a line that was printed'])).toEqual(['organized', 'raw'])
    expect(readingsOf([null, undefined])).toEqual(['organized', 'raw'])
  })
})

describe('test readingOf', () => {
  test('should keep the reading where the value has it', () => {
    expect(readingOf('table', users)).toBe('table')
    expect(readingOf('html', '<p>hi</p>')).toBe('html')
  })

  test('should draw the tree where the value has no such reading, never a blank pane', () => {
    expect(readingOf('table', 5)).toBe('organized')
    expect(readingOf('html', users)).toBe('organized')
    expect(readingOf('table', [1, 2])).toBe('organized')
  })
})

describe('test cellOf', () => {
  test('should quote a string the way the tree does', () => {
    expect(cellOf('Ada')).toEqual({
      kind: 'string',
      className: 't-string',
      text: '"Ada"',
      full: '"Ada"',
      cut: false,
    })
  })

  test('should cut a long string and keep the whole of it for the tooltip', () => {
    const long = 'x'.repeat(200)
    const cell = cellOf(long)

    expect(cell.cut).toBe(true)
    expect(cell.text).toBe(`"${'x'.repeat(120)}…"`)
    expect(cell.full).toBe(`"${long}"`)
  })

  test('should read a number, a boolean and nothing as themselves', () => {
    expect(cellOf(12.5).text).toBe('12.5')
    expect(cellOf(false).text).toBe('false')
    expect(cellOf(null).text).toBe('null')
  })

  test('should leave a composite to the caller, which names it', () => {
    expect(cellOf({a: 1}).kind).toBe('composite')
  })

  test('should read a key a row does not carry as an empty cell', () => {
    expect(cellOf(undefined).text).toBe('')
    expect(cellOf(undefined).cut).toBe(false)
  })
})

describe('test the tree scalars', () => {
  test('should colour a value by what it is', () => {
    expect(scalarClass('a')).toBe('t-string')
    expect(scalarClass(1)).toBe('t-number')
    expect(scalarClass(true)).toBe('t-bool')
    expect(scalarClass(null)).toBe('t-null')
  })

  test('should write a value the way php would echo it', () => {
    expect(scalarText('Ada')).toBe('"Ada"')
    expect(scalarText(1)).toBe('1')
    expect(scalarText(false)).toBe('false')
    expect(scalarText(null)).toBe('null')
  })

  test('should cut a long string with one ellipsis at the end', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcde…')
    expect(truncate('abc', 5)).toBe('abc')
  })
})
