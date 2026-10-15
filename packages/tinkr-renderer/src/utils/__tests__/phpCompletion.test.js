import {
  createCompletionProvider,
  registerPHPCompletionProvider,
  toMonacoItem,
} from '../phpCompletion'

const languages = {
  CompletionItemKind: {Class: 17, Method: 0},
  CompletionItemInsertTextRule: {InsertAsSnippet: 4},
}

const monaco = {
  languages: {
    ...languages,
    registerCompletionItemProvider: (id, provider) => ({id, provider, dispose: () => {}}),
  },
}

// the parts of a monaco model the provider reads: a one line document, with the
// cursor at its end
const model = code => ({
  getOffsetAt: () => code.length,
  getPositionAt: offset => ({lineNumber: 1, column: offset + 1}),
  getValueInRange: ({startColumn, endColumn}) => code.slice(startColumn - 1, endColumn - 1),
})

const token = {isCancellationRequested: false}

// what a method item inserts: a snippet whose caret starts in its first
// parameter (written in two pieces so it is not read as a template)
const whereCall = 'where($' + '{1:column})'

const provide = (ask, code, context = {}) =>
  createCompletionProvider(monaco, ask).provideCompletionItems(model(code), {lineNumber: 1, column: code.length + 1}, context, token)

describe('the snippet completion provider', () => {
  test('opens the popup on a `::`, a `->` and a namespace separator', () => {
    expect(createCompletionProvider(monaco, () => ({})).triggerCharacters).toEqual([':', '>', '\\'])
  })

  test('asks the connection for what is typed before the cursor', async () => {
    const asked = []
    const ask = request => {
      asked.push(request)

      return Promise.resolve({items: []})
    }

    await provide(ask, 'Teatro::wh', {triggerCharacter: ':'})

    expect(asked).toEqual([{code: 'Teatro::wh', offset: 10, triggerCharacter: ':'}])
  })

  test('sends the end of a long snippet, the code a suggestion is read from', async () => {
    const asked = []
    const code = `${'x'.repeat(25000)}Tea`

    await provide(request => {
      asked.push(request)

      return Promise.resolve({items: []})
    }, code)

    expect(asked[0].code).toHaveLength(20000)
    expect(asked[0].code.endsWith('Tea')).toBe(true)
    expect(asked[0].offset).toBe(20000)
  })

  test('reads a class name as a class item, and a method as a method item', async () => {
    const {suggestions} = await provide(() => Promise.resolve({
      items: [
        {type: 'class', label: 'Teatro', detail: 'App\\Models\\Teatro', filter: 'Teatro', insert: 'Teatro'},
        {
          type: 'method',
          label: 'where(mixed $column)',
          detail: 'Builder',
          filter: 'where',
          insert: whereCall,
          snippet: true,
        },
      ],
    }), 'Teatro::wh')

    expect(suggestions).toEqual([
      {
        label: 'Teatro',
        filterText: 'Teatro',
        detail: 'App\\Models\\Teatro',
        kind: 17,
        insertText: 'Teatro',
        insertTextRules: undefined,
      },
      {
        label: 'where(mixed $column)',
        filterText: 'where',
        detail: 'Builder',
        kind: 0,
        insertText: whereCall,
        insertTextRules: 4,
      },
    ])
  })

  test('shows nothing, rather than a broken editor, when the answer never comes', async () => {
    expect(await provide(() => Promise.reject(new Error('no')), 'Tea')).toEqual({suggestions: []})
    expect(await provide(() => Promise.resolve(null), 'Tea')).toEqual({suggestions: []})
    expect(await provide(() => Promise.resolve({}), 'Tea')).toEqual({suggestions: []})
  })

  test('shows nothing for an answer monaco no longer waits for', async () => {
    const cancelled = await createCompletionProvider(monaco, () => Promise.resolve({
      items: [{type: 'class', label: 'Teatro', insert: 'Teatro'}],
    })).provideCompletionItems(
      model('Tea'),
      {lineNumber: 1, column: 4},
      {},
      {isCancellationRequested: true},
    )

    expect(cancelled).toEqual({suggestions: []})
  })

  test('is registered for the snippet language', () => {
    const registered = registerPHPCompletionProvider(monaco, () => Promise.resolve({items: []}))

    expect(registered.id).toBe('php-snippet')
    expect(typeof registered.provider.provideCompletionItems).toBe('function')
  })

  test('keeps a snippet item a snippet, and a name a plain insertion', () => {
    const item = toMonacoItem(
      {type: 'class', label: 'Teatro', filter: 'Teatro', detail: 'App\\Models\\Teatro', insert: 'Teatro'},
      languages.CompletionItemKind,
      languages.CompletionItemInsertTextRule.InsertAsSnippet,
    )

    expect(item.insertTextRules).toBe(undefined)
    expect(item.kind).toBe(17)
  })
})
