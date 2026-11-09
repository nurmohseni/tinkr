// the stores read the snippets out of the main process as they are loaded, so
// window.api has to be in place before the modules are required, and the hook
// has to be required with them: it must reach the same store modules the test
// drives. React is required in the same breath, because a module loaded after
// `resetModules` is a fresh copy of react, and the copy that draws has to be the
// copy whose hooks the component runs
const load = snippets => {
  window.api = {
    allSnippets: jest.fn(() => snippets),
    createSnippet: jest.fn(),
    updateSnippet: jest.fn(),
    deleteSnippet: jest.fn(),
    getConnection: jest.fn(() => ({id: 'c1'})),
  }

  jest.resetModules()

  // the components the hook sits under are built with the classic jsx runtime,
  // so the React they reach has to be this fresh copy, not the one this file
  // started with
  const React = require('react')

  global.React = React

  return {
    React,
    ReactDOM: require('react-dom'),
    act: require('react-dom/test-utils').act,
    Provider: require('jotai').Provider,
    createStore: require('jotai').createStore,
    RouterProvider: require('../../components/RouterProvider').default,
    hook: require('../useOpenDocuments').default,
    snippets: require('../../stores/snippets'),
    tabs: require('../../stores/tabs'),
    sessions: require('../../stores/sessions'),
  }
}

let host
let mounted

// what the window has open and what it is on, as the tab bar and the route read
// them: the hook is the one place both come from
const mount = ({React, ReactDOM, act, Provider, createStore, RouterProvider, hook}) => {
  const store = createStore()
  const Probe = () => {
    const {activeId, documents} = hook()

    return React.createElement(
      'span',
      {'data-active': activeId},
      documents.map(document => document.id).join(','),
    )
  }

  host = document.createElement('div')
  document.body.appendChild(host)
  mounted = {ReactDOM, act}

  act(() => {
    ReactDOM.render(
      React.createElement(
        Provider,
        {store},
        React.createElement(RouterProvider, null, React.createElement(Probe)),
      ),
      host,
    )
  })

  return store
}

const at = hash => {
  window.location.hash = hash
}

const active = () => host.querySelector('span').dataset.active

const first = {id: 's1', name: 'Magic', code: '1 + 1'}
const second = {id: 's2', name: 'Other', code: '2 + 1'}

afterEach(() => {
  if (host) {
    const {ReactDOM, act} = mounted

    act(() => {
      ReactDOM.unmountComponentAtNode(host)
    })
    host.remove()
    host = null
    mounted = null
  }

  window.location.hash = ''
})

describe('the documents the window has open', () => {
  // the bug this waits against: an agent deleted a snippet through the MCP
  // server, the file changed, and the window kept a tab for a document that was
  // no longer in it
  test('closes the tab of a snippet another writer deleted, and moves on from it', async () => {
    const loaded = load({s1: first})

    at('#/snippets/s1/editor')
    const store = mount(loaded)

    // the route names the snippet, so it is open
    expect(store.get(loaded.tabs.openTabsAtom)).toEqual(['s1'])
    expect(active()).toBe('s1')

    // the hash change the close navigates with lands on a task of its own, the
    // way it lands after a click in the window
    await loaded.act(async () => {
      store.set(loaded.snippets.snippetsConnectionAtom, {connection: 'c1', snippets: {}})
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // the tab is gone with the snippet, and the window took the way out a user
    // closing that tab takes: the next one along, and here the session left
    expect(store.get(loaded.tabs.openTabsAtom)).not.toContain('s1')
    expect(window.location.hash).toBe('#/')
    expect(active()).toBe(store.get(loaded.sessions.sessionsAtom)[0].id)
    expect(host.textContent).not.toContain('s1')
  })

  test('closes the tab of a snippet deleted behind the window without moving it', () => {
    const loaded = load({s1: first, s2: second})

    at('#/snippets/s2/editor')
    const store = mount(loaded)

    loaded.act(() => {
      store.set(loaded.tabs.openTabAtom, 's1')
    })

    expect(store.get(loaded.tabs.openTabsAtom)).toEqual(['s2', 's1'])

    loaded.act(() => {
      store.set(loaded.snippets.snippetsConnectionAtom, {connection: 'c1', snippets: {s2: second}})
    })

    // only the deleted one goes, and the window stays on the snippet it was on
    expect(store.get(loaded.tabs.openTabsAtom)).toEqual(['s2'])
    expect(window.location.hash).toBe('#/snippets/s2/editor')
    expect(active()).toBe('s2')
  })
})
