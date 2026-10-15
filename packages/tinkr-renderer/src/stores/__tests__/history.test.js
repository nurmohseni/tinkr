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

  beforeEach(() => {
    api = {
      allHistory: jest.fn(() => [entry]),
      allSnippets: jest.fn(() => ({s1: {id: 's1', name: 'Magic', code: 'the old code'}})),
      updateSnippet: jest.fn(),
    }

    window.api = api
    jest.resetModules()

    history = require('../history')
    store = createStore()
  })

  test('the list is the one the main process kept', () => {
    expect(store.get(history.historyListAtom)).toEqual([entry])
  })

  test('a row loads its code into the snippet the window is on', () => {
    store.set(history.loadHistoryAtom, {snippetId: 's1', entry})

    expect(api.updateSnippet).toHaveBeenCalledWith({id: 's1', name: 'Magic', code: '1 + 1'})
    expect(store.get(history.loadedHistoryAtom)).toEqual({
      snippetId: 's1',
      entryId: 'a1',
      code: '1 + 1',
    })
  })

  test('with no snippet to load into, nothing is written', () => {
    store.set(history.loadHistoryAtom, {snippetId: undefined, entry})
    store.set(history.loadHistoryAtom, {snippetId: 's1'})

    expect(api.updateSnippet).not.toHaveBeenCalled()
    expect(store.get(history.loadedHistoryAtom)).toBe(null)
  })
})
