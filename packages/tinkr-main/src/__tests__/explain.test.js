jest.mock('../createBackgroundPty', () => ({ensureBackgroundPty: jest.fn()}))

const {explainQuery, driverCode, planCode} = require('../explain')
const {ensureBackgroundPty} = require('../createBackgroundPty')
const {
  setEditorConnection,
  setBackgroundPtyProcess,
} = require('../processes')

/**
 * A session that answers the two questions a plan asks: its driver, and the
 * rows an EXPLAIN returns. Every line it was given is kept, so a test can read
 * what was actually sent.
 */
const session = (driver = 'sqlite') => ({
  asked: [],
  jsonResult(code) {
    this.asked.push(code)

    if (code.includes("['driver'=>")) {
      return Promise.resolve(JSON.stringify({driver}))
    }

    // what sqlite answers for a select with one binding
    return Promise.resolve(JSON.stringify({
      plan: [
        {id: 2, parent: 0, notused: 0, detail: 'SEARCH orders USING INDEX orders_paid_index (paid=?)'},
      ],
    }))
  },
})

const connection = {id: 'fixture', name: 'Fixture', command: 'php artisan tinker'}

beforeEach(() => {
  jest.clearAllMocks()
  setEditorConnection('fixture', connection)
  setBackgroundPtyProcess('fixture', null)
})

describe('asking a connection for the plan of one of its queries', () => {
  test('the driver is asked once and sqlite gets EXPLAIN QUERY PLAN', async () => {
    const pty = session('sqlite')

    setBackgroundPtyProcess('fixture', pty)
    ensureBackgroundPty.mockImplementation(() => {})

    const first = await explainQuery('fixture', {
      connection: 'fixture',
      sql: 'select * from orders where paid = ?',
      bindings: [1],
    })

    expect(first.driver).toBe('sqlite')
    expect(first.plan[0].detail).toContain('SEARCH orders')

    // the driver question is one per session and connection, not one per plan
    await explainQuery('fixture', {
      connection: 'fixture',
      sql: 'select * from orders',
      bindings: [],
    })

    expect(pty.asked.filter(code => code.includes("['driver'=>"))).toHaveLength(1)

    // and the second question is the plan itself, on the statement the driver
    // calls a plan, with the bindings it ran with
    expect(pty.asked[1]).toContain('EXPLAIN QUERY PLAN select * from orders where paid = ?')
    expect(pty.asked[1]).toContain('[1]')
  })

  test('mysql and pgsql get EXPLAIN, and the bindings travel with the statement', async () => {
    for (const driver of ['mysql', 'mariadb', 'pgsql']) {
      const pty = session(driver)

      setBackgroundPtyProcess('fixture', pty)

      await explainQuery('fixture', {
        connection: 'app',
        sql: 'select * from orders where paid = ?',
        bindings: ['one', 2],
      })

      expect(pty.asked[1]).toContain('EXPLAIN select * from orders where paid = ?')
      // the connection name is the laravel one, not the window's
      expect(pty.asked[0]).toContain('\'app\'')
      expect(pty.asked[1]).toContain('["one",2]')
    }
  })

  test('a write is refused before anything is asked of the session', async () => {
    const pty = session('sqlite')

    setBackgroundPtyProcess('fixture', pty)

    await expect(explainQuery('fixture', {
      connection: 'fixture',
      sql: 'update orders set paid = 1 where id = 1',
      bindings: [],
    })).rejects.toThrow('only a SELECT')

    expect(pty.asked).toEqual([])
  })

  test('a query already explained is not explained again', async () => {
    const pty = session('sqlite')

    setBackgroundPtyProcess('fixture', pty)

    await expect(explainQuery('fixture', {
      connection: 'fixture',
      sql: 'EXPLAIN select * from orders',
      bindings: [],
    })).rejects.toThrow('only a SELECT')

    expect(pty.asked).toEqual([])
  })

  test('Laravel Cloud is never asked: a command there is in its history', async () => {
    setEditorConnection('cloud', {id: 'cloud', name: 'Cloud', is_cloud: true})
    setBackgroundPtyProcess('cloud', session('mysql'))

    await expect(explainQuery('cloud', {
      connection: 'app',
      sql: 'select * from orders',
      bindings: [],
    })).rejects.toThrow('Laravel Cloud')

    expect(ensureBackgroundPty).not.toHaveBeenCalled()
  })

  test('Laravel Vapor is never asked: a command there is in its history', async () => {
    setEditorConnection('vapor', {id: 'vapor', name: 'Vapor', is_vapor: true})
    setBackgroundPtyProcess('vapor', session('mysql'))

    await expect(explainQuery('vapor', {
      connection: 'app',
      sql: 'select * from orders',
      bindings: [],
    })).rejects.toThrow('a plan is not asked of Laravel Vapor')

    expect(ensureBackgroundPty).not.toHaveBeenCalled()
  })

  test('an unopened connection is refused', async () => {
    await expect(explainQuery('missing', {sql: 'select 1', bindings: []}))
      .rejects.toThrow('the connection is not open')
  })
})

describe('the php that asks the question', () => {
  test('a plan is asked with the connection it names and its bindings', () => {
    const code = planCode('app', 'EXPLAIN select * from orders where paid = ?', [1, 'Ada'])

    expect(code).toContain('$tinkr_name=\'app\'')
    expect(code).toContain('connection($tinkr_name)')
    expect(code).toContain('EXPLAIN select * from orders where paid = ?')
    expect(code).toContain('json_decode(\'[1,"Ada"]\'')
    expect(code).toContain('["plan"=>')
  })

  test('the default connection is asked without a name', () => {
    expect(driverCode(null)).toContain('$tinkr_name=null')
    expect(driverCode(null)).toContain('connection($tinkr_name)')
    expect(planCode(null, 'EXPLAIN select 1', [])).toContain('$tinkr_name=null')
    expect(planCode(null, 'EXPLAIN select 1', [])).toContain('connection($tinkr_name)')
    // no name at all is still an empty list of bindings, never a null one
    expect(planCode(null, 'EXPLAIN select 1', null)).toContain('json_decode(\'[]\'')
  })
})
