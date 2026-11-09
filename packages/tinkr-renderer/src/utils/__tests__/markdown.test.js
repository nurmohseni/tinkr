const {runMarkdown, markdownCell, MARKDOWN_LIMIT} = require('../markdown')

const labels = {
  connection: 'Connection',
  when: 'When',
  returned: 'Returned',
  printed: 'Printed',
  error: 'Error',
  trace: 'Trace',
  line: line => `Line ${line}`,
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

  test('writes a value without what the run knew about it', () => {
    const markdown = runMarkdown(run({
      result: {
        value: {id: 1, name: 'Ada', __tinkrClass: 'App\\Models\\User', __tinkrKey: 1, __tinkrRelations: ['posts']},
        error: null,
        output: '',
        queries: [],
        queriesTotal: 0,
      },
    }))

    // a note about the value is not a field of it: the fence holds the data
    expect(markdown).toContain('"id": 1')
    expect(markdown).toContain('"name": "Ada"')
    expect(markdown).not.toContain('__tinkrClass')
    expect(markdown).not.toContain('__tinkrKey')
    expect(markdown).not.toContain('__tinkrRelations')
  })

  test('writes a rendered value as the markup it is', () => {
    const markdown = runMarkdown(run({
      result: {
        value: {__tinkrClass: 'Illuminate\\Support\\HtmlString', __tinkrHtml: '<b>x</b>'},
        error: null,
        output: '',
        queries: [],
        queriesTotal: 0,
      },
    }))

    expect(markdown).toContain('**Returned**')
    expect(markdown).toContain('<b>x</b>')
    expect(markdown).not.toContain('__tinkrHtml')
  })
  test('a print that carries a fence is held by a longer fence of its own', () => {
    const markdown = runMarkdown(run({
      result: {value: null, error: null, output: '```php\ninside a fence\n```', queries: []},
    }))

    // the block the run writes is not ended by the fence the print carries
    expect(markdown).toContain('````text\n```php\ninside a fence\n```\n````')
    // and a body with no fence of its own still gets the shortest fence
    expect(runMarkdown(run({
      result: {value: null, error: null, output: 'plain', queries: []},
    }))).toContain('```text\nplain\n```')
  })

  test('a value that is itself a document does not end the block it is written in', () => {
    const markdown = runMarkdown(run({
      result: {value: 'a ``` fence', error: null, output: '', queries: []},
    }))
    // the json is fenced by four backticks, so its own three are just text
    expect(markdown).toContain('````json\n"a ``` fence"\n````')
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

  test('carries where an error was thrown, and the frames it came through', () => {
    const error = {
      class: 'QueryException',
      message: 'nope',
      line: null,
      file: 'app/Models/User.php',
      fileLine: 42,
      trace: [
        {file: 'vendor/framework/src/Connection.php', line: 760, class: null, function: 'runQueryCallback', snippet: false},
        {file: null, line: 3, class: 'App\\Models\\User', function: 'get', snippet: true},
      ],
    }
    const markdown = runMarkdown(run({
      result: {value: null, error, output: '', blocks: [], queries: []},
    }))

    // the section is the one the export already writes for an error, and these
    // are its two facts under it: where, then the frames in the list the guard
    // report already uses
    expect(markdown).toContain('**Error**\n\nQueryException: nope\n\napp/Models/User.php:42')
    expect(markdown).toContain('**Trace**')
    expect(markdown).toContain('- 0. vendor/framework/src/Connection.php:760 runQueryCallback')
    expect(markdown).toContain('- 1. Line 3 App\\Models\\User->get')
  })

  test('a throw in the snippet is named by the line of the snippet', () => {
    const markdown = runMarkdown(run({
      result: {
        value: null,
        error: {class: 'RuntimeException', message: 'boom', line: 3, file: null, fileLine: null, trace: []},
        output: '',
        blocks: [],
        queries: [],
      },
    }))

    // no frames to list, so there is no list: the line is what the export knows
    expect(markdown).toContain('RuntimeException: boom\n\nLine 3')
    expect(markdown).not.toContain('**Trace**')
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

describe('what a run dumped, how it ended, what it spent', () => {
  const facts = {
    dumped: 'Dumped',
    ended: {label: 'Ended', text: 'The run ended with dd() on line 2'},
    stats: {label: 'Stats', text: '12 ms · 1.5 MB'},
  }

  test('carries the value a dump was shown, under the line it was dumped from', () => {
    const markdown = runMarkdown(run({
      labels: Object.assign({}, labels, {dumped: facts.dumped}),
      result: {
        value: null,
        error: null,
        output: 'dumped:{"name":"z"}',
        blocks: [{line: 2, value: null, error: null, dumps: [{line: 2, value: {name: 'z'}}]}],
        ended: {by: 'dd', line: 2},
        queries: [],
      },
      ended: facts.ended,
      stats: facts.stats,
    }))

    expect(markdown).toContain('**Ended**\n\nThe run ended with dd() on line 2')
    expect(markdown).toContain('**Stats**\n\n12 ms · 1.5 MB')
    expect(markdown).toContain('**Dumped · Line 2**')
    expect(markdown).toContain('"name": "z"')
    // the print is still the print: the block carries both facts
    expect(markdown).toContain('**Printed**')
  })

  test('says nothing about an ending, a measurement or a dump a run did not have', () => {
    const markdown = runMarkdown(run())

    expect(markdown).not.toContain('**Ended**')
    expect(markdown).not.toContain('**Stats**')
    expect(markdown).not.toContain('**Dumped')
  })
})
