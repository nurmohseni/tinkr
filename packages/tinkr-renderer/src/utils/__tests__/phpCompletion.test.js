import {
  createCompletionProvider,
  importEditAt,
  registerPHPCompletionProvider,
  toMonacoItem,
  toMonacoItems,
} from '../phpCompletion'

// monaco's own numbers for the kinds, so a row's icon is the one monaco would
// draw
const kinds = {
  Method: 0,
  Function: 1,
  Field: 3,
  Variable: 4,
  Class: 5,
  Interface: 7,
  Module: 8,
  Property: 9,
  Value: 13,
  Constant: 14,
  Enum: 15,
  Keyword: 17,
  Text: 18,
  Reference: 21,
}

const insertAsSnippet = 4

const monaco = {
  languages: {
    CompletionItemKind: kinds,
    CompletionItemInsertTextRule: {InsertAsSnippet: insertAsSnippet},
    registerCompletionItemProvider: (id, provider) => ({id, provider, dispose: () => {}}),
  },
}

// an offset in the snippet as a monaco position: the model's own answer, which
// is what the import edit's range is built out of
const positionAt = code => {
  const starts = [0]

  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') {
      starts.push(i + 1)
    }
  }

  return offset => {
    let line = 0

    while (line + 1 < starts.length && starts[line + 1] <= offset) {
      line++
    }

    return {lineNumber: line + 1, column: offset - starts[line] + 1}
  }
}

// the parts of a monaco model the provider reads: the whole snippet, and the
// caret at its end
const model = code => ({
  getValue: () => code,
  getOffsetAt: () => code.length,
  getPositionAt: positionAt(code),
})

const token = {isCancellationRequested: false}

const context = code => ({
  kinds,
  insertAsSnippet,
  code,
  positionAt: positionAt(code),
})

// what a method item inserts: a snippet whose caret starts in its first
// parameter (written in two pieces so it is not read as a template)
const whereCall = 'where($' + '{1:column})'

const answer = items => () => Promise.resolve({items})

const provide = (ask, code, trigger = {}) =>
  createCompletionProvider(monaco, ask).provideCompletionItems(
    model(code),
    {lineNumber: 1, column: code.length + 1},
    trigger,
    token,
  )

describe('the snippet completion provider', () => {
  test('opens the popup on a `::`, a `->`, a namespace separator, a quote and a `$`', () => {
    expect(createCompletionProvider(monaco, () => ({})).triggerCharacters)
      .toEqual([':', '>', '\\', "'", '"', '$'])
  })

  test('asks the connection for the whole snippet and where the caret is', async () => {
    const asked = []
    const code = "<?php\n$key = 'app.timezone';\nconfig($key)"

    await provide(request => {
      asked.push(request)

      return Promise.resolve({items: []})
    }, code, {triggerCharacter: '('})

    // the type of a name is what the snippet assigned to it, and an import goes
    // where the snippet's `use` lines are, so nothing before the caret is cut
    // away
    expect(asked).toEqual([{code, offset: code.length, triggerCharacter: '('}])
  })

  test('sends a pasted snippet whole, since the answer is read from all of it', async () => {
    const asked = []
    const code = `${'x'.repeat(25000)}Tea`

    await provide(request => {
      asked.push(request)

      return Promise.resolve({items: []})
    }, code)

    expect(asked[0].code).toHaveLength(25003)
    expect(asked[0].offset).toBe(25003)
  })

  test('gives every kind of answer its own icon', () => {
    const cases = [
      ['class', 5],
      ['interface', 7],
      ['trait', 8],
      ['enum', 15],
      ['function', 1],
      ['method', 0],
      ['property', 9],
      ['attribute', 3],
      ['relation', 21],
      ['scope', 0],
      ['constant', 14],
      ['variable', 4],
      ['keyword', 17],
      ['value', 13],
    ]

    for (const [type, kind] of cases) {
      expect([type, toMonacoItem({type, label: 'x'}, context('')).kind]).toEqual([type, kind])
    }

    // an answer of a kind this does not know is still a row, not a crash
    expect(toMonacoItem({type: 'other', label: 'x'}, context('')).kind).toBe(18)
  })

  test('ranks the rows the way the main process grouped them', async () => {
    const {suggestions} = await provide(answer([
      {type: 'keyword', label: 'foreach', sort: '5', insert: 'foreach'},
      {type: 'method', label: 'where', sort: '2', insert: 'where'},
      {type: 'attribute', label: 'name', sort: '0', insert: 'name'},
      {type: 'class', label: 'User', detail: 'App\\Models\\User', sort: '2', insert: 'User'},
    ]), 'User::wh')

    expect(suggestions.map(row => row.label)).toEqual(['name', 'User', 'where', 'foreach'])
    expect(suggestions.map(row => row.sortText)).toEqual(['0name', '2User', '2where', '5foreach'])
  })

  test('filters on the name, and inserts what the row says', async () => {
    const {suggestions} = await provide(answer([
      {type: 'method', label: 'where(mixed $column)', detail: 'Builder', filter: 'where', insert: whereCall, snippet: true},
      {type: 'property', label: 'name', detail: 'string', filter: 'name', insert: 'name'},
      {type: 'variable', label: '$user', insert: '$user'},
    ]), '$user->')

    expect(suggestions.find(row => row.filterText === 'where')).toEqual({
      label: 'where(mixed $column)',
      kind: 0,
      filterText: 'where',
      sortText: '3where(mixed $column)',
      insertText: whereCall,
      insertTextRules: insertAsSnippet,
      detail: 'Builder',
    })
    // a row with no snippet is inserted plainly, and one with no filter is
    // filtered on its own label
    expect(suggestions.find(row => row.filterText === 'name').insertTextRules).toBe(undefined)
    expect(suggestions.find(row => row.label === '$user').filterText).toBe('$user')
  })

  test('shows a docblock as markdown', () => {
    const row = toMonacoItem(
      {type: 'method', label: 'where', documentation: '**where** — adds a clause'},
      context(''),
    )

    expect(row.documentation).toEqual({value: '**where** — adds a clause', isTrusted: false})
  })

  test('writes the `use` line a class row needs, after the snippet\'s own', async () => {
    const code = '<?php\nuse Foo\\Bar;\n$x = User::first();'
    const {suggestions} = await provide(answer([
      {type: 'class', label: 'User', detail: 'App\\Models\\User', insert: 'User', import: 'App\\Models\\User'},
    ]), code)

    expect(suggestions[0].additionalTextEdits).toEqual([{
      range: {startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1},
      text: 'use App\\Models\\User;\n',
    }])
  })

  test('writes no second `use` for a class the snippet already imports', async () => {
    const code = '<?php\nuse App\\Models\\User;\n$u = User::first();'
    const {suggestions} = await provide(answer([
      {type: 'class', label: 'User', detail: 'App\\Models\\User', insert: 'User', import: 'App\\Models\\User'},
    ]), code)

    expect(suggestions[0].additionalTextEdits).toBe(undefined)
  })

  test('leaves a name that needs no import alone', async () => {
    const {suggestions} = await provide(answer([
      {type: 'function', label: 'strlen', insert: 'strlen'},
      {type: 'class', label: 'DateTime', insert: 'DateTime', import: 'DateTime'},
    ]), '<?php\n$x = 1;')

    expect(suggestions[0].additionalTextEdits).toBe(undefined)
    expect(suggestions[1].additionalTextEdits).toBe(undefined)
  })

  test('shows one row for a name reached two ways', async () => {
    const {suggestions} = await provide(answer([
      {type: 'class', label: 'User', detail: 'App\\Models\\User', insert: 'User'},
      {type: 'class', label: 'User', detail: 'App\\Models\\User', insert: 'User'},
      {type: 'class', label: 'User', detail: 'Illuminate\\Foundation\\Auth\\User', insert: 'User'},
    ]), 'Us')

    expect(suggestions.map(row => row.detail))
      .toEqual(['App\\Models\\User', 'Illuminate\\Foundation\\Auth\\User'])
  })

  test('holds the popup to 200 rows, in the same order every time', async () => {
    const items = Array.from({length: 250}, (unused, at) => ({
      type: 'class',
      label: `Item${String(at).padStart(3, '0')}`,
      detail: 'App\\Models\\Item',
      insert: 'Item',
      sort: '2',
    }))

    const first = await provide(answer(items), 'Item')
    const second = await provide(answer(items), 'Item')

    expect(first.suggestions).toHaveLength(200)
    expect(first.suggestions[0].label).toBe('Item000')
    expect(first.suggestions.map(row => row.label)).toEqual(second.suggestions.map(row => row.label))
  })

  test('is registered for the snippet language', () => {
    const registered = registerPHPCompletionProvider(monaco, () => Promise.resolve({items: []}))

    expect(registered.id).toBe('php-snippet')
    expect(typeof registered.provider.provideCompletionItems).toBe('function')
  })

  test('shows nothing, rather than a broken editor, when the answer never comes', async () => {
    expect(await provide(() => Promise.reject(new Error('no')), 'Tea')).toEqual({suggestions: []})
    expect(await provide(() => Promise.resolve(null), 'Tea')).toEqual({suggestions: []})
    expect(await provide(() => Promise.resolve({}), 'Tea')).toEqual({suggestions: []})
  })

  test('tells monaco a list was answered before its read was done', async () => {
    // the main process answers what it holds and says so; monaco asks again on the
    // next keystroke only when the list is marked, so the mark is what is tested
    const short = await provide(() => Promise.resolve({items: [{type: 'method', label: 'where'}], incomplete: true}), 'Order::')

    expect(short.incomplete).toBe(true)
    expect(short.suggestions.map(row => row.label)).toEqual(['where'])

    // a whole list carries no mark at all: an answer that is complete is not one to
    // ask again for
    const whole = await provide(answer([{type: 'method', label: 'where'}]), 'Order::')

    expect('incomplete' in whole).toBe(false)
  })

  test('shows nothing for an answer monaco no longer waits for', async () => {
    const cancelled = await createCompletionProvider(monaco, answer([
      {type: 'class', label: 'Teatro', insert: 'Teatro'},
    ])).provideCompletionItems(
      model('Tea'),
      {lineNumber: 1, column: 4},
      {},
      {isCancellationRequested: true},
    )

    expect(cancelled).toEqual({suggestions: []})
  })
})

// the same vectors as tinkr-core's classIndex test: the main process aliases a
// run's classes with this rule, and the popup writes the `use` line with it
const importVectors = [
  ['$u = User::first();', 'App\\Models\\User'],
  ['<?php\n\nuse Foo\\Bar;\n\n$u = 1;', 'App\\Models\\User'],
  ['<?php $x = 1;', 'App\\Models\\User'],
  ['<?php\nuse App\\Models\\User;\n$u = User::first();', 'App\\Models\\User'],
  ['<?php\nuse App\\Models\\User as U;\n$u = U::first();', 'App\\Models\\User'],
  ['<?php\nuse App\\Models\\{Order, User};\n', 'App\\Models\\User'],
  ['<?php\nnamespace App\\Models;\n$u = new User;', 'App\\Models\\User'],
  ['<?php\nnamespace App\\Models;\n', 'Other\\Models\\User'],
  ['<?php\n$u = new DateTime;', 'DateTime'],
  ['<?php\nuse Other\\User;\n$u = 1;', 'App\\Models\\User'],
  ['<?php\nclass A { use HasThing; }\n', 'App\\Models\\User'],
  // a `use` line in a comment, a string or a heredoc imports nothing
  ['<?php\n// use App\\Models\\User;\n$x = 1;', 'App\\Models\\User'],
  ['<?php\n$s = "use Foo\\Bar;";\n$x = 1;', 'App\\Models\\User'],
  ['<?php\n$x = <<<EOT\nuse Foo\\Bar;\nEOT;\n$y = 1;', 'App\\Models\\User'],
  ['<?php\n$f = function () use ($x) { return $x; };\n', 'App\\Models\\User'],
  ['<?php\r\nuse A\\B;\r\n$x = 1;', 'App\\Models\\User'],
]

describe('the import line the popup writes', () => {
  test('is the main process\'s own rule, for every shape a snippet has', () => {
    const {importEditAt: fromCore} = require('../../../../tinkr-core/src/classIndex')

    for (const [code, fqcn] of importVectors) {
      expect([code, fqcn, importEditAt(code, fqcn)]).toEqual([code, fqcn, fromCore(code, fqcn)])
    }
  })

  test('is applied to the snippet the row is inserted into', () => {
    const rows = toMonacoItems([
      {type: 'class', label: 'Order', detail: 'App\\Models\\Order', insert: 'Order', import: 'App\\Models\\Order'},
    ], context('<?php\n\n$o = 1;'))

    expect(rows[0].additionalTextEdits).toEqual([{
      range: {startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1},
      text: 'use App\\Models\\Order;\n',
    }])
  })
})
