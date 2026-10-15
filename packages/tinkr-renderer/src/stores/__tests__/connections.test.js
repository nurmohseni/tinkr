import {createStore} from 'jotai'

// The store reads the connections out of the main process as it is loaded, so
// window.api has to be in place before the module is required.
describe('connections store', () => {
  const stored = {
    id: 'a1',
    tag: 'local',
    name: 'Magic',
    is_over_ssh: false,
    path: '/srv/magic',
    command: 'php artisan tinker',
  }

  let api
  let store
  let connections

  beforeEach(() => {
    api = {
      allConnections: jest.fn(() => ({[stored.id]: {...stored}})),
      createConnection: jest.fn(),
      updateConnection: jest.fn(),
      deleteConnection: jest.fn(),
      connectConnection: jest.fn(),
    }

    window.api = api
    jest.resetModules()

    connections = require('../connections')
    store = createStore()
  })

  test('a connection the store does not hold is written when it is confirmed, not before', () => {
    const draft = {
      id: 'draft',
      tag: 'local',
      name: 'New Connection',
      is_over_ssh: false,
      path: '',
      command: '',
    }

    expect(store.get(connections.connectionDataAtom)).not.toHaveProperty(draft.id)

    store.set(connections.connectConnectionAtom, draft)

    expect(api.createConnection).toHaveBeenCalledTimes(1)
    expect(api.createConnection).toHaveBeenCalledWith(draft)
    expect(api.connectConnection).toHaveBeenCalledTimes(1)
    expect(api.connectConnection).toHaveBeenCalledWith(draft)
    expect(store.get(connections.connectionDataAtom)).toHaveProperty(draft.id)
  })

  test('a connection the store holds is connected to without being written again', () => {
    const edited = {...stored, name: 'Magic!'}

    store.set(connections.connectConnectionAtom, edited)

    expect(api.createConnection).not.toHaveBeenCalled()
    expect(api.connectConnection).toHaveBeenCalledTimes(1)
    expect(api.connectConnection).toHaveBeenCalledWith(edited)
  })

  test('the autosave of a draft writes nothing', () => {
    store.set(connections.updateConnectionAtom, {id: 'draft', name: 'Typed'})

    expect(api.updateConnection).not.toHaveBeenCalled()
    expect(store.get(connections.connectionDataAtom)).not.toHaveProperty('draft')
  })

  test('the autosave of a stored connection writes it', () => {
    const edited = {...stored, name: 'Magic!'}

    store.set(connections.updateConnectionAtom, edited)

    expect(api.updateConnection).toHaveBeenCalledWith(edited)
    expect(store.get(connections.connectionDataAtom)[stored.id].name).toBe('Magic!')
  })
})
