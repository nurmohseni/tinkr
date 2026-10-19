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
    // the store also carries the switch, whose business is every store a
    // connection owns, so the fakes those read from are here too
    api = {
      allConnections: jest.fn(() => ({[stored.id]: {...stored}})),
      createConnection: jest.fn(),
      updateConnection: jest.fn(),
      deleteConnection: jest.fn(),
      connectConnection: jest.fn(),
      forgetPassword: jest.fn(),
      getConnection: jest.fn(() => ({...stored})),
      allSnippets: jest.fn(() => ({})),
      allHistory: jest.fn(() => []),
      allConfig: jest.fn(() => ({locale: 'en', theme: 'dark'})),
      setConfig: jest.fn(),
      aiAsk: jest.fn(),
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

  // the password is the main process's to keep. What the form holds is what the
  // main process is given; what the window keeps is the connection without it,
  // so a password is never in the store the renderer draws from
  describe('a password', () => {
    const draft = () => ({
      id: 'draft',
      tag: 'ssh',
      name: 'New Connection',
      is_over_ssh: true,
      ssh_server: 'db.example.com',
      ssh_user: 'root',
      path: '',
      command: '',
      password: 'hunter2',
    })

    test('is handed to the main process when a draft is confirmed, and kept out of the window', () => {
      store.set(connections.connectConnectionAtom, draft())

      // the main process writes the password, so both messages carry the form
      expect(api.createConnection).toHaveBeenCalledWith(expect.objectContaining({password: 'hunter2'}))
      expect(api.connectConnection).toHaveBeenCalledWith(expect.objectContaining({password: 'hunter2'}))

      // and the moment the main process has written it, the window's copy says a
      // password is kept rather than holding one
      expect(store.get(connections.connectionDataAtom).draft.password).toBe(undefined)
      expect(store.get(connections.connectionDataAtom).draft.ssh_password).toBe(true)
    })

    test('is handed over on an autosave, and never drawn from the window', () => {
      const edited = {...stored, ssh_password: true, password: 'hunter2'}

      store.set(connections.updateConnectionAtom, edited)

      expect(api.updateConnection).toHaveBeenCalledWith(expect.objectContaining({password: 'hunter2'}))
      expect(store.get(connections.connectionDataAtom)[stored.id].password).toBe(undefined)
    })

    // an autosave fires on every field, and one that did not touch the password
    // must not look like the password having been cleared
    test('that was not typed does not clear the one that is kept', () => {
      const edited = {...stored, name: 'Renamed', ssh_password: true, password: ''}

      store.set(connections.updateConnectionAtom, edited)

      expect(api.updateConnection).toHaveBeenCalledWith(expect.objectContaining({password: ''}))
      expect(store.get(connections.connectionDataAtom)[stored.id].ssh_password).toBe(true)
    })
  })
})
