import {createStore} from 'jotai'

// The stores read the connection, its snippets and its runs out of the main
// process as they are loaded, so window.api has to be in place before the
// modules are required.
describe('switching the window connection', () => {
  const first = {id: 'c1', name: 'One'}
  const second = {id: 'c2', name: 'Two'}

  let api
  let store
  let connection
  let stores

  beforeEach(() => {
    connection = first

    api = {
      allConnections: jest.fn(() => ({c1: first, c2: second})),
      getConnection: jest.fn(() => connection),
      allSnippets: jest.fn(() => (connection === first
        ? {s1: {id: 's1', name: 'Of One', code: '1'}}
        : {s2: {id: 's2', name: 'Of Two', code: '2'}})),
      allHistory: jest.fn(() => (connection === first
        ? [{id: 'h1', code: '1', at: 1, outcome: 'returned'}]
        : [])),
      allConfig: jest.fn(() => ({locale: 'en', theme: 'dark', editor_layout: 'side'})),
      setConfig: jest.fn(),
      aiAsk: jest.fn(),
    }

    window.api = api
    jest.resetModules()

    stores = {
      connections: require('../connections'),
      editor: require('../editor'),
      sessions: require('../sessions'),
      tabs: require('../tabs'),
      ai: require('../ai'),
      config: require('../config'),
    }
    store = createStore()
  })

  test('it is the new connection the window reads its documents, runs and snippets from', () => {
    // a session with code, a run's result and a thread are all the old one's
    store.set(stores.sessions.addSessionAtom, stores.sessions.newSession({name: '18:30', code: 'old'}))
    store.set(stores.tabs.openTabAtom, 's1')
    store.set(stores.editor.resultAtom, {value: 1, error: null})
    store.set(stores.ai.aiThreadAtom, [{id: 1, prompt: 'about the other project'}])

    connection = second
    store.set(stores.connections.switchConnectionAtom)

    expect(store.get(stores.editor.connectionAtom)).toEqual(second)
    expect(Object.values(store.get(stores.connections.connectionDataAtom))).toEqual([first, second])
    expect(Object.keys(store.get(stores.connections.connectionDataAtom))).toEqual(['c1', 'c2'])
    // the snippets and the runs of the connection it is on now
    expect(Object.values(store.get(require('../snippets').snippetDataAtom))).toEqual([
      {id: 's2', name: 'Of Two', code: '2'},
    ])
    expect(store.get(require('../history').historyListAtom)).toEqual([])
  })

  test('and nothing of the old connection is still on screen', () => {
    store.set(stores.sessions.addSessionAtom, stores.sessions.newSession({name: '18:30', code: 'old'}))
    store.set(stores.tabs.openTabAtom, 's1')
    store.set(stores.editor.resultAtom, {value: 1, error: null})
    store.set(stores.editor.outputAtom, 'array:1 [\n  0 => "a"\n]')
    store.set(stores.ai.aiThreadAtom, [{id: 1, prompt: 'about the other project'}])

    connection = second
    store.set(stores.connections.switchConnectionAtom)

    // one session, empty, and it is the window's own
    const sessions = store.get(stores.sessions.sessionsAtom)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].code).toBe('')
    expect(sessions[0].name).toBe('')
    // no tabs of the connection it left, no result of its run, no thread of its code
    expect(store.get(stores.tabs.openTabsAtom)).toEqual([])
    expect(store.get(stores.editor.resultAtom)).toBe(null)
    expect(store.get(stores.editor.outputAtom)).toBe('')
    expect(store.get(stores.ai.aiThreadAtom)).toEqual([])
  })

  test('what is not about a connection is left exactly as it was', () => {
    const config = store.get(stores.config.configAtom)

    connection = second
    store.set(stores.connections.switchConnectionAtom)

    // the window was not loaded again, so the preferences it holds are still the
    // ones it had: the theme, the layout, the language
    expect(store.get(stores.config.configAtom)).toBe(config)
    expect(store.get(stores.config.configAtom).theme).toBe('dark')
  })
})
