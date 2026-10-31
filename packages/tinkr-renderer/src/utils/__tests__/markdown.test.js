const {runMarkdown, markdownCell, MARKDOWN_LIMIT} = require('../markdown')

const labels = {
  connection: 'Connection',
  when: 'When',
  returned: 'Returned',
  printed: 'Printed',
  error: 'Error',
  queries: 'Queries',
  dryRun: 'Dry run',
  sandbox: 'Sandbox',
  statement: line => `Statement at line ${line}`,
  truncated: count => `truncated, ${count} more characters`,
  moreQueries: count => `+${count} more queries, not captured`,
  sql: 'sql',
  bindings: 'bindings',
  ms: 'ms',
  connectionColumn: 'connection',
}

const run = overrides => Object.assign({
  code: 'Order::all();',
  result: {
    value: [{id: 1, customer: 'Ada'}],
    error: null,
    output: '',
    queries: [],
    queriesTotal: 0,
    ranAt: '2026-10-31T10:30:00.000Z',
  },
  connection: 'Fixture',
  when: 'Oct 31, 2026 10:30 AM',
  labels,
}, overrides)

describe('a run as markdown', () => {
  test('says where and when it ran, then the code and the value', () => {
    const markdown = runMarkdown(run())

    expect(markdown).toContain('Connection: Fixture')
    expect(markdown).toContain('When: Oct 31, 2026 10:30 AM')
    expect(markdown).toContain('```php\nOrder::all();\n```')
    expect(markdown).toContain('**Returned**')
    expect(markdown).toContain('```json\n[\n  {\n    "id": 1,\n    "customer": "Ada"\n  }\n]\n```')
    // heading-free: what was pasted goes under a title someone else wrote
    expect(markdown).not.toMatch(/^#/m)
  })

  test('carries what the run printed, in the text fence', () => {
    const markdown = runMarkdown(run({
      result: {value: null, error: null, output: 'hello\nworld', queries: []},
    }))

    expect(markdown).toContain('**Printed**')
    expect(markdown).toContain('```text\nhello\nworld\n```')
    expect(markdown).not.toContain('**Returned**')
  })

  test('carries the exception class and message when it threw', () => {
    const markdown = runMarkdown(run({
      result: {
        value: null,
        error: {class: 'RuntimeException', message: 'the order was not found'},
        output: '',
        queries: [],
      },
    }))

    expect(markdown).toContain('**Error**')
    expect(markdown).toContain('RuntimeException: the order was not found')
  })

  test('a run of several statements writes each value, on the line that answered it', () => {
    const markdown = runMarkdown(run({
      result: {
        value: 3,
        error: null,
        output: '',
        blocks: [
          {line: 1, value: 1},
          {line: 3, value: {name: 'Ada'}},
          {line: 5, value: 3},
        ],
        queries: [],
      },
    }))

    expect(markdown).toContain('**Statement at line 1**')
    expect(markdown).toContain('**Statement at line 3**')
    expect(markdown).toContain('"name": "Ada"')
    expect(markdown).toContain('**Statement at line 5**')
    // the last block's value is the run's value, and is not written twice
    expect(markdown.match(/```json/g)).toHaveLength(3)
  })

  test('a statement that threw says so where it threw', () => {
    const markdown = runMarkdown(run({
      result: {
        value: null,
        error: {class: 'RuntimeException', message: 'boom'},
        blocks: [
          {line: 1, value: 1},
          {line: 2, error: {class: 'RuntimeException', message: 'boom'}},
        ],
        queries: [],
      },
    }))

    expect(markdown).toContain('**Statement at line 2**\n\nError: RuntimeException: boom')
  })

  test('the queries are a table of sql, bindings, ms and connection', () => {
    const markdown = runMarkdown(run({
      result: {
        value: 1,
        error: null,
        output: '',
        queries: [
          {line: 1, sql: 'select * from orders where paid = ?', bindings: [1], time: 1.82, connection: 'fixture'},
          {line: 2, sql: 'update orders set paid = 0', bindings: [], time: 0.4, connection: 'fixture'},
        ],
        queriesTotal: 3,
      },
    }))

    expect(markdown).toContain('| # | sql | bindings | ms | connection |')
    expect(markdown).toContain('| --- | --- | --- | --- | --- |')
    expect(markdown).toContain('| 1 | select * from orders where paid = ? | [1] | 1.82 | fixture |')
    expect(markdown).toContain('| 2 | update orders set paid = 0 | [] | 0.4 | fixture |')
    // what the capture did not hold is said rather than passed off as the whole log
    expect(markdown).toContain('_+1 more queries, not captured_')
  })

  test('a pipe in a cell is escaped, and a newline stays in its row', () => {
    expect(markdownCell("select 'a|b'")).toBe("select 'a\\|b'")
    expect(markdownCell('one\ntwo')).toBe('one<br>two')

    const markdown = runMarkdown(run({
      result: {
        value: 1,
        error: null,
        output: '',
        queries: [{line: 1, sql: "select 'a|b' as x\ngroup by x", bindings: ['a|b'], time: 1, connection: 'fixture'}],
      },
    }))

    expect(markdown).toContain("select 'a\\|b' as x<br>group by x")
    expect(markdown).toContain('["a\\|b"]')
  })

  test('a value larger than a paste is cut, and the cut is said', () => {
    const value = 'x'.repeat(MARKDOWN_LIMIT + 25)
    const cut = JSON.stringify(value, null, 2).length - MARKDOWN_LIMIT
    const markdown = runMarkdown(run({
      result: {value, error: null, output: '', queries: []},
    }))

    expect(markdown).toContain(`truncated, ${cut} more characters`)
    // the fence holds the cap, not the whole of a megabyte
    expect(markdown.indexOf('```', markdown.indexOf('```json') + 7)).toBeLessThan(MARKDOWN_LIMIT + 200)
  })

  test('the dry run and the sandbox are reported when the run was guarded', () => {
    const markdown = runMarkdown(run({
      guarded: {
        dryRun: ['Rolled back 1 statement on fixture', '1 statement on other ran outside the dry run'],
        sandbox: ['1 mail recorded', 'Nothing was sent'],
      },
    }))

    expect(markdown).toContain('**Dry run**\n\n- Rolled back 1 statement on fixture\n- 1 statement on other ran outside the dry run')
    expect(markdown).toContain('**Sandbox**\n\n- 1 mail recorded\n- Nothing was sent')
  })

  test('a run with nothing in it is nothing to paste', () => {
    expect(runMarkdown({labels})).toBe('')
  })
})
