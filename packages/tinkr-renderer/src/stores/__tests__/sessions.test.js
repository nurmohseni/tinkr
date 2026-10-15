import {createStore} from 'jotai'

// The stores read the connection's snippets out of the main process as they are
// loaded, so window.api has to be in place before the modules are required.
describe('sessions store', () => {
  const snippet = {id: 's1', name: 'Magic', code: 'the old code'}

  let api
  let store
  let sessions

  const all = () => store.get(sessions.sessionsAtom)
  const find = id => all().find(session => session.id === id)
  const ids = () => all().map(session => session.id)

  beforeEach(() => {
    api = {
      allSnippets: jest.fn(() => ({s1: snippet})),
      createSnippet: jest.fn(),
      updateSnippet: jest.fn(),
      deleteSnippet: jest.fn(),
    }

    window.api = api
    jest.resetModules()

    sessions = require('../sessions')
    store = createStore()
  })

  test('a window opens on one empty session, and it is the one on screen', () => {
    const [session] = all()

    expect(store.get(sessions.documentAtomWithId(session.id))).toEqual(session)
    expect({name: session.name, code: session.code, position: session.position})
      .toEqual({name: '', code: '', position: null})
    expect(store.get(sessions.activeSessionAtom)).toEqual(session)
  })

  test('an open snippet is the document the store holds', () => {
    expect(store.get(sessions.documentAtomWithId('s1'))).toEqual(snippet)
  })

  test('a session that has been closed is no document at all', () => {
    const [session] = all()

    store.set(sessions.removeSessionAtom, session.id)

    expect(store.get(sessions.documentAtomWithId(session.id))).toBe(null)
    expect(store.get(sessions.activeSessionAtom)).toBe(null)
  })

  test('code typed into a session stays in this window', () => {
    const [session] = all()

    store.set(sessions.writeCodeAtom, {
      id: session.id,
      code: '1 + 1',
      position: {lineNumber: 1, column: 6},
    })

    expect(find(session.id).code).toBe('1 + 1')
    expect(find(session.id).position).toEqual({lineNumber: 1, column: 6})
    expect(api.updateSnippet).not.toHaveBeenCalled()
  })

  test('code typed into a snippet is written to the connection', () => {
    store.set(sessions.writeCodeAtom, {id: 's1', code: '2 + 2'})

    expect(store.get(sessions.documentAtomWithId('s1')).code).toBe('2 + 2')
    expect(api.updateSnippet).toHaveBeenCalledWith(expect.objectContaining({id: 's1', code: '2 + 2'}))
  })

  test('every + is another session, and each keeps its own code', () => {
    const [first] = all()
    const second = sessions.newSession()

    store.set(sessions.addSessionAtom, second)
    store.set(sessions.writeCodeAtom, {id: first.id, code: 'typed into the first'})
    store.set(sessions.writeCodeAtom, {id: second.id, code: 'typed into the second'})

    expect(ids()).toEqual([first.id, second.id])
    expect(find(first.id).code).toBe('typed into the first')
    expect(find(second.id).code).toBe('typed into the second')
    // the window is on the session it has just started
    expect(store.get(sessions.activeSessionAtom).id).toBe(second.id)
  })

  test('the root route falls back to a session the window still has', () => {
    const [first] = all()
    const second = sessions.newSession()

    store.set(sessions.addSessionAtom, second)
    store.set(sessions.removeSessionAtom, second.id)

    expect(ids()).toEqual([first.id])
    expect(store.get(sessions.activeSessionAtom).id).toBe(first.id)
  })

  test('the window is never left without a session to fall back to', () => {
    const [first] = all()

    store.set(sessions.removeSessionAtom, first.id)

    expect(store.get(sessions.activeSessionAtom)).toBe(null)

    store.set(sessions.ensureSessionAtom)

    expect(all().length).toBe(1)
    expect(all()[0].id).not.toBe(first.id)
    expect(store.get(sessions.activeSessionAtom).id).toBe(all()[0].id)
  })

  test('a window that still has a session starts nothing', () => {
    const [first] = all()

    store.set(sessions.ensureSessionAtom)

    expect(ids()).toEqual([first.id])
    expect(store.get(sessions.activeSessionAtom).id).toBe(first.id)
  })

  test('a document that is not there is no document', () => {
    expect(store.get(sessions.documentAtomWithId(undefined))).toBe(null)
  })
})
