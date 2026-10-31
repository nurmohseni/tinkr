const {isExplainable} = require('../explain')
const core = require('../../../../tinkr-core/src/explain')

// the renderer decides which rows offer the plan, and the main process decides
// what it will send. They are two copies of one rule because the renderer cannot
// load the main process's library; this is the test that says so.
const cases = [
  'select * from orders',
  'SELECT 1',
  '\n  select 1',
  '-- why\nselect 1',
  '/* why */ select 1',
  '# why\nselect 1',
  'explain select 1',
  'EXPLAIN QUERY PLAN select 1',
  "insert into t values ('a|b')",
  'update t set a = 1',
  'delete from t',
  'with x as (select 1) select * from x',
  'pragma table_info(t)',
  '',
  null,
  undefined,
  42,
]

describe('the rule a row is offered a plan by', () => {
  test('is the rule the main process sends one by', () => {
    for (const sql of cases) {
      expect(isExplainable(sql)).toBe(core.isExplainable(sql))
    }
  })
})
