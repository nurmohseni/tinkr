import {createStore} from 'jotai'

// The store reads the snippets out of the main process as it is loaded, so
// window.api has to be in place before the module is required.
describe('snippets store', () => {
  const snippet = {id: 's1', name: 'Magic', code: '1 + 1'}

  const load = allSnippets => {
    window.api = {
      allSnippets: jest.fn(() => allSnippets),
      createSnippet: jest.fn(),
      updateSnippet: jest.fn(),
      deleteSnippet: jest.fn(),
    }

    jest.resetModules()

    return {store: createStore(), snippets: require('../snippets')}
  }

  test('a connection with no snippets has an empty list', () => {
    const {store, snippets} = load({})

    expect(store.get(snippets.snippetListAtom)).toEqual([])
  })

  test('the list is the one the main process kept', () => {
    const {store, snippets} = load({s1: snippet})

    expect(store.get(snippets.snippetListAtom)).toEqual([snippet])
  })

  test('a new snippet is listed and written', () => {
    const {store, snippets} = load({})
    // built as the app builds one, with its id in hand: nanoid reads the
    // browser's crypto, which is not there under jsdom
    const created = {id: 's2', name: 'Runs the report', code: ''}

    store.set(snippets.createSnippetAtom, created)

    expect(store.get(snippets.snippetListAtom)).toEqual([created])
    expect(window.api.createSnippet).toHaveBeenCalledWith(created)
  })

  test('a rename reaches the snippet the list holds', () => {
    const {store, snippets} = load({s1: snippet})

    store.set(snippets.updateSnippetAtom, {id: 's1', name: 'Renamed'})

    expect(store.get(snippets.snippetListAtom)).toEqual([{...snippet, name: 'Renamed'}])
    expect(window.api.updateSnippet).toHaveBeenCalledWith({...snippet, name: 'Renamed'})
  })

  test('dropping the last snippet leaves an empty list', () => {
    const {store, snippets} = load({s1: snippet})

    store.set(snippets.deleteSnippetAtom, 's1')

    expect(store.get(snippets.snippetListAtom)).toEqual([])
    expect(window.api.deleteSnippet).toHaveBeenCalledWith('s1')
  })
})
