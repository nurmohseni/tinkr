const {isExplainable, explainSql, normalizeBindings} = require('../explain')

describe('what may be explained', () => {
  test('a select is a plan the app may ask for', () => {
    expect(isExplainable('select * from orders')).toBe(true)
    expect(isExplainable('SELECT id FROM orders WHERE paid = ?')).toBe(true)
    // a statement written by hand may open with whitespace or a comment
    expect(isExplainable('\n  select 1')).toBe(true)
    expect(isExplainable('-- what this is\nselect 1')).toBe(true)
    expect(isExplainable('/* the report */\nselect 1')).toBe(true)
    expect(isExplainable('# mysql comment\nselect 1')).toBe(true)
  })

  test('a write is not', () => {
    expect(isExplainable('insert into orders (customer) values (\'Ada\')')).toBe(false)
    expect(isExplainable('update orders set paid = 1')).toBe(false)
    expect(isExplainable('delete from orders')).toBe(false)
    expect(isExplainable('truncate table orders')).toBe(false)
    expect(isExplainable('pragma table_info(orders)')).toBe(false)
  })

  test('an explain is already a plan, and is not asked for another', () => {
    expect(isExplainable('explain select * from orders')).toBe(false)
    expect(isExplainable('  /* plan */ EXPLAIN select * from orders')).toBe(false)
  })

  test('a statement that is not a string is nothing to explain', () => {
    expect(isExplainable(null)).toBe(false)
    expect(isExplainable(undefined)).toBe(false)
    expect(isExplainable({sql: 'select 1'})).toBe(false)
  })
})

describe('the statement a driver is given', () => {
  test('sqlite asks for a query plan', () => {
    expect(explainSql('sqlite', 'select * from orders')).toBe('EXPLAIN QUERY PLAN select * from orders')
  })

  test('mysql, mariadb and pgsql ask for an explain', () => {
    expect(explainSql('mysql', 'select 1')).toBe('EXPLAIN select 1')
    expect(explainSql('mariadb', 'select 1')).toBe('EXPLAIN select 1')
    expect(explainSql('pgsql', 'select 1')).toBe('EXPLAIN select 1')
    expect(explainSql('postgresql', 'select 1')).toBe('EXPLAIN select 1')
  })

  test('the driver is read without regard to case', () => {
    expect(explainSql('SQLite', 'select 1')).toBe('EXPLAIN QUERY PLAN select 1')
    expect(explainSql('MySQL', 'select 1')).toBe('EXPLAIN select 1')
  })

  test('a driver with no explain of its own is refused rather than guessed at', () => {
    expect(() => explainSql('sqlsrv', 'select 1')).toThrow('sqlsrv')
    expect(() => explainSql('', 'select 1')).toThrow('unknown')
    expect(() => explainSql(null, 'select 1')).toThrow('unknown')
  })
})

describe('the bindings a plan is asked with', () => {
  test('the bindings the query was sent with are the ones the plan gets', () => {
    const bindings = [1, 'Ada', null, true]

    expect(normalizeBindings(bindings)).toBe(bindings)
    expect(normalizeBindings(bindings)).toEqual([1, 'Ada', null, true])
  })

  test('an envelope with no bindings is an empty list, not one undefined binding', () => {
    expect(normalizeBindings(undefined)).toEqual([])
    expect(normalizeBindings(null)).toEqual([])
    expect(normalizeBindings('1')).toEqual([])
    expect(normalizeBindings({id: 1})).toEqual([])
  })
})
