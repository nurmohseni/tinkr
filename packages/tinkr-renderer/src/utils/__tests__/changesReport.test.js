import {changesReport, keyText, valueText} from '../changesReport'

const change = overrides => Object.assign({
  connection: 'mysql',
  table: 'orders',
  key: {id: 1},
  op: 'updated',
  before: {paid: 1},
  after: {paid: 0},
}, overrides)

describe('what a guarded run changed', () => {
  test('is nothing for a run with no changes and nothing undiffed', () => {
    expect(changesReport(undefined)).toBe(null)
    expect(changesReport({outcome: 'rolledBack', changes: [], changesTotal: 0})).toBe(null)
    expect(changesReport({outcome: 'rolledBack', undiffed: {count: 0, sample: []}})).toBe(null)
  })

  test('groups the rows of one table, in the order they happened', () => {
    const report = changesReport({
      connection: 'mysql',
      changes: [
        change({op: 'updated', key: {id: 1}}),
        change({op: 'created', key: {id: 2}, before: null, after: {customer: 'Ada'}}),
        change({table: 'invoices', key: {id: 9}, op: 'deleted', before: {total: 3}}),
      ],
      changesTotal: 3,
    })

    expect(report.total).toBe(3)
    expect(report.shown).toBe(3)
    expect(report.cut).toBe(false)
    expect(report.groups.map(group => group.table)).toEqual(['orders', 'invoices'])
    expect(report.groups[0].rows.map(row => row.op)).toEqual(['updated', 'created'])
    expect(report.groups[0].rows[0].columns).toEqual([{name: 'paid', before: 1, after: 0}])
  })

  test('reads each operation from the side of the change it has', () => {
    const report = changesReport({
      changes: [
        change({op: 'created', before: null, after: {customer: 'Ada', paid: 0}}),
        change({op: 'deleted', before: {customer: 'Grace'}, after: null}),
      ],
      changesTotal: 2,
    })

    const [created, deleted] = report.groups[0].rows

    // a created row is its values, a deleted one its last values: neither is
    // drawn as an update from or to nothing
    expect(created.columns).toEqual([
      {name: 'customer', before: undefined, after: 'Ada'},
      {name: 'paid', before: undefined, after: 0},
    ])
    expect(deleted.columns).toEqual([{name: 'customer', before: 'Grace', after: undefined}])
  })

  test('keeps the rows of the same table on two connections apart', () => {
    const report = changesReport({
      connection: 'mysql',
      changes: [
        change({connection: 'mysql'}),
        change({connection: 'other'}),
      ],
      changesTotal: 2,
    })

    expect(report.groups.map(group => group.connection)).toEqual(['mysql', 'other'])
  })

  test('says whether it is showing all of them', () => {
    const report = changesReport({
      changes: [change()],
      changesTotal: 60,
    })

    // the list is capped where it is collected; the count is not
    expect(report.shown).toBe(1)
    expect(report.total).toBe(60)
    expect(report.cut).toBe(true)
  })

  test('carries the writes nothing could describe', () => {
    const report = changesReport({
      changes: [],
      changesTotal: 0,
      undiffed: {count: 2, sample: ['update orders set paid = ?', null, '']},
    })

    expect(report.groups).toEqual([])
    expect(report.undiffed).toEqual({count: 2, sample: ['update orders set paid = ?']})
  })

  test('names the operation it does not know rather than dropping the row', () => {
    const report = changesReport({changes: [change({op: 'truncated'})], changesTotal: 1})

    expect(report.groups[0].rows[0].op).toBe('other')
  })

  test('writes a key and a value the way the value tree does', () => {
    expect(keyText({id: 1})).toBe('id 1')
    expect(keyText({slug: 'a-b'})).toBe('slug "a-b"')
    expect(keyText({tenant: 3, id: 7})).toBe('tenant 3, id 7')
    expect(keyText(null)).toBe(null)
    expect(keyText({})).toBe(null)
    expect(valueText(null)).toBe('null')
    expect(valueText(true)).toBe('true')
    expect(valueText('Ada')).toBe('"Ada"')
    // a composite is one line of json, cut to a cell
    expect(valueText([1, 2])).toBe('[1,2]')
    expect(valueText('x'.repeat(200))).toHaveLength(121)
    expect(valueText('x'.repeat(200)).endsWith('…')).toBe(true)
  })
})
