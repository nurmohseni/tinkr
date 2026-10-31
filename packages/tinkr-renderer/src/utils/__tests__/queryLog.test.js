import {planCell, planTable, queryText, sqlCell, sqlText} from '../queryLog'

const queries = [
  {line: 1, sql: 'select 1 as n', bindings: [], time: 1.82, connection: 'mysql'},
  {line: 2, sql: 'select * from `migrations` where batch > ?', bindings: [3], time: 0.4, connection: 'mysql'},
]

describe('test sqlText', () => {
  test('should terminate every statement and put each on its own line', () => {
    expect(sqlText(queries)).toBe('select 1 as n;\nselect * from `migrations` where batch > ?;')
  })

  test('should copy the placeholders the connection was given, not the bindings', () => {
    expect(sqlText([queries[1]])).toBe('select * from `migrations` where batch > ?;')
  })

  test('should copy nothing at all for a run that sent nothing', () => {
    expect(sqlText([])).toBe('')
  })
})

describe('test sqlCell', () => {
  test('should leave a statement that fits alone, and say it is whole', () => {
    expect(sqlCell(queries[0].sql)).toEqual({text: 'select 1 as n', cut: false})
  })

  test('should cut a statement longer than a cell shows, saying it was cut', () => {
    const long = `select * from orders where ${'id > 1 and '.repeat(20)}id < 2`

    expect(sqlCell(long)).toEqual({text: `${long.slice(0, 120)}…`, cut: true})
  })
})

describe('test queryText', () => {
  test('should carry the line, the bindings and the connection with the sql', () => {
    expect(JSON.parse(queryText(queries[1]))).toEqual(queries[1])
  })

  test('should write it as json a person reads', () => {
    expect(queryText(queries[0])).toBe([
      '{',
      '  "line": 1,',
      '  "sql": "select 1 as n",',
      '  "bindings": [],',
      '  "time": 1.82,',
      '  "connection": "mysql"',
      '}',
    ].join('\n'))
  })
})

describe('test planTable', () => {
  test('should name every column the driver returned, in the order it named them', () => {
    const table = planTable([
      {id: 2, parent: 0, notused: 0, detail: 'SCAN orders'},
      {id: 3, parent: 0, detail: 'SEARCH orders USING INDEX'},
    ])

    expect(table.columns).toEqual(['id', 'parent', 'notused', 'detail'])
    expect(table.rows).toHaveLength(2)
  })

  test('should drop a row that is not a row, rather than draw an empty one', () => {
    expect(planTable([null, 'SEARCH', [1, 2], {detail: 'SCAN'}]).rows).toEqual([{detail: 'SCAN'}])
    expect(planTable(undefined)).toEqual({columns: [], rows: []})
    expect(planTable({plan: []})).toEqual({columns: [], rows: []})
  })
})

describe('test planCell', () => {
  test('should write a plan value as itself, not as a quoted json string', () => {
    expect(planCell('SCAN orders')).toEqual({text: 'SCAN orders', full: 'SCAN orders', cut: false})
    expect(planCell(3)).toEqual({text: '3', full: '3', cut: false})
    expect(planCell(null)).toEqual({text: '', full: '', cut: false})
  })

  test('should cut a detail that does not fit a cell, keeping the whole for the title', () => {
    const detail = 'SCAN '.repeat(200)

    expect(planCell(detail).text).toHaveLength(401)
    expect(planCell(detail).text.endsWith('…')).toBe(true)
    expect(planCell(detail).cut).toBe(true)
  })
})
