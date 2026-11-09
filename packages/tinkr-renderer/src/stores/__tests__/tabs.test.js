import {createStore} from 'jotai'

// The tabs store holds ids and nothing else, so nothing here reads the main
// process and the modules need no window.api to be loaded.
describe('tabs store', () => {
  let store
  let tabs

  beforeEach(() => {
    jest.resetModules()

    tabs = require('../tabs')
    store = createStore()
  })

  test('a window opens with nothing open', () => {
    expect(store.get(tabs.openTabsAtom)).toEqual([])
  })

  test('a document has one tab, and the tabs keep their order', () => {
    store.set(tabs.openTabAtom, 'session:1')
    store.set(tabs.openTabAtom, 'session:1')
    store.set(tabs.openTabAtom, 's1')

    expect(store.get(tabs.openTabsAtom)).toEqual(['session:1', 's1'])
  })

  test('closing a tab takes that tab and no other', () => {
    store.set(tabs.openTabAtom, 'session:1')
    store.set(tabs.openTabAtom, 's1')
    store.set(tabs.closeTabAtom, 'session:1')

    expect(store.get(tabs.openTabsAtom)).toEqual(['s1'])
  })

  test('closing a tab that is not open writes nothing', () => {
    store.set(tabs.openTabAtom, 's1')
    const before = store.get(tabs.openTabsAtom)

    store.set(tabs.closeTabAtom, 's2')

    // the same list, not a copy of it: a reader that closes what it finds gone
    // has nothing left to close on the next pass
    expect(store.get(tabs.openTabsAtom)).toBe(before)
  })

  test('a session named as a snippet keeps its tab where it was', () => {
    store.set(tabs.openTabAtom, 's1')
    store.set(tabs.openTabAtom, 'session:1')
    store.set(tabs.openTabAtom, 's2')

    store.set(tabs.replaceTabAtom, {from: 'session:1', to: 's3'})

    expect(store.get(tabs.openTabsAtom)).toEqual(['s1', 's3', 's2'])
  })

  test('a session named as a snippet opens the snippet when it had no tab', () => {
    store.set(tabs.replaceTabAtom, {from: 'session:1', to: 's3'})

    expect(store.get(tabs.openTabsAtom)).toEqual(['s3'])
  })
})
