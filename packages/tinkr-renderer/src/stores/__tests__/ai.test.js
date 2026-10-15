import {createStore} from 'jotai'

// the thread's own store reaches the connection only through these, and a
// jsdom has no window.api for them to be real: the snippets store asks for the
// list as it loads, which is why it is here and not only aiAsk
jest.mock('../../utils/api', () => ({
  aiAsk: jest.fn(),
  allSnippets: () => [],
}))

describe('the ai thread', () => {
  let store
  let ai
  let api

  beforeEach(() => {
    jest.resetModules()

    api = require('../../utils/api')
    ai = require('../ai')
    store = createStore()
  })

  test('holds the ask while the provider is still answering it', async () => {
    let answer
    api.aiAsk.mockReturnValue(new Promise(resolve => {
      answer = resolve
    }))

    const asking = store.set(ai.askAiAtom, {documentId: 'session:1', prompt: 'dump the config'})

    // the ask is in the thread before there is an answer to it
    const [pending] = store.get(ai.aiThreadAtom)

    expect(pending.prompt).toBe('dump the config')
    expect(pending.asking).toBe(true)
    expect(store.get(ai.aiAskingAtom)).toBe(true)

    answer({answer: 'Here it is.\n\n```php\ndump(config(\'app\'));\n```'})
    await asking

    const [turn] = store.get(ai.aiThreadAtom)

    expect(turn.id).toBe(pending.id)
    expect(turn.asking).toBe(false)
    expect(turn.text).toBe('Here it is.')
    expect(turn.code).toBe("dump(config('app'));")
    expect(store.get(ai.aiAskingAtom)).toBe(false)
  })

  test('says what the provider said when it cannot answer', async () => {
    api.aiAsk.mockRejectedValue(new Error('no answer from the provider'))

    await store.set(ai.askAiAtom, {documentId: 'session:1', prompt: 'anything'})

    const [turn] = store.get(ai.aiThreadAtom)

    expect(turn.prompt).toBe('anything')
    expect(turn.failed).toBe(true)
    expect(turn.text).toBe('no answer from the provider')
  })

  test('reads the next ask against the turns before it', async () => {
    api.aiAsk.mockResolvedValue({answer: 'ok'})

    await store.set(ai.askAiAtom, {documentId: 'session:1', prompt: 'first'})
    await store.set(ai.askAiAtom, {documentId: 'session:1', prompt: 'second'})

    const request = api.aiAsk.mock.calls.at(-1)[0]

    expect(request.prompt).toBe('second')
    expect(request.history).toEqual([
      {role: 'user', content: 'first'},
      {role: 'assistant', content: 'ok'},
    ])
  })

  test('resolves one proposal and no other', async () => {
    api.aiAsk.mockResolvedValue({answer: '```php\ndump(1);\n```'})

    await store.set(ai.askAiAtom, {documentId: 'session:1', prompt: 'first'})
    await store.set(ai.askAiAtom, {documentId: 'session:1', prompt: 'second'})

    const [first, second] = store.get(ai.aiThreadAtom)

    store.set(ai.resolveTurnAtom, {id: first.id, resolution: 'applied'})

    expect(store.get(ai.aiThreadAtom).map(turn => turn.resolution)).toEqual(['applied', null])
    expect(second.code).toBe('dump(1);')
  })
})
