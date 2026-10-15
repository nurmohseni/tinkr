import {createStore} from 'jotai'

// The store reads the history out of the main process as it is loaded, so
// window.api has to be in place before the module is required.
describe('history store', () => {
  const entry = {
    id: 'a1',
    code: '1 + 1',
    at: Date.now(),
    outcome: 'returned',
  }

  let api
  let store
  let history
  let sessions

  beforeEach(() => {
    api = {
      allHistory: jest.fn(() => [entry]),
      allSnippets: jest.fn(() => ({s1: {id: 's1', name: 'Magic', code: 'the old code'}})),
    }

    window.api = api
    jest.resetModules()

    history = require('../history')
    sessions = require('../sessions')
    store = createStore()
  })

  test('the list is the one the main process kept', () => {
    expect(store.get(history.historyListAtom)).toEqual([entry])
  })

  test('a session starts empty, which is what a + opens', () => {
    expect(sessions.newSession()).toMatchObject({name: '', code: ''})
  })

  test('a run opened from the history arrives in its own session', () => {
    // the code of the run is in it before the editor ever sees the session, and
    // the time it ran is the only name a session can have
    const opened = sessions.newSession({name: '18:30', code: entry.code})

    expect(opened).toMatchObject({name: '18:30', code: '1 + 1'})

    store.set(sessions.addSessionAtom, opened)

    expect(store.get(sessions.activeSessionAtom)).toEqual(opened)
  })

  test('two sessions are two documents, whatever they hold', () => {
    const first = sessions.newSession({name: '18:30', code: entry.code})
    const second = sessions.newSession()

    expect(first.id).not.toBe(second.id)
  })
})
