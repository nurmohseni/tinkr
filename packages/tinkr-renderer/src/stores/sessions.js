import {atom} from 'jotai'

import {snippetAtomWithId, updateSnippetAtom} from './snippets'

/**
 * The unsaved sessions of this window: what a + opens, and what a connection
 * opens on while nothing else is.
 *
 * A session is not a snippet. Nothing of it is written to the connection, it
 * has no row in the sidebar, and it lives here, in the window, for as long as
 * the window does. Any number of them are open at once — each its own document,
 * with its own id, its own code and its own caret — and they are the one scratch
 * buffer the window used to keep, except that there is no longer only one.
 *
 * Everything else about a session works the way a snippet does, because the
 * editor, the Run button and a history row all reach the code they show through
 * one id, and a session mints an id of its own: the ids of the store only ever
 * hold letters, digits, - and _, so an id that carries a colon is a session and
 * nothing else, and every new session gets a new one — which is what makes it a
 * new document to the editor rather than the same one emptied.
 */
const sessionPrefix = 'session:'

let opened = 0

const newSession = () => ({
  id: `${sessionPrefix}${++opened}`,
  name: '',
  code: '',
  position: null,
})

const isSessionId = id => typeof id === 'string' && id.startsWith(sessionPrefix)

/**
 * The sessions the window has open, in the order they were started. Every one
 * of them is a document the tab bar draws while it is open, and none of them is
 * anywhere else.
 */
const sessionsAtom = atom([newSession()])

const sessionAtoms = {}

/**
 * The session of that id, or null when the window has closed it: a session
 * outlives its atom only as long as the tab that holds it, so a document that
 * has been closed reads as nothing rather than as a stale copy.
 *
 * @param {String} id
 * @returns {Atom}
 */
const sessionAtomWithId = id => {
  if (!sessionAtoms[id]) {
    sessionAtoms[id] = atom(get => get(sessionsAtom).find(session => session.id === id) || null)
  }

  return sessionAtoms[id]
}

const emptyAtom = atom(null)

/**
 * The document the editor is showing: a snippet of the store, or one of this
 * window's sessions.
 *
 * @param {String} id
 * @returns {Atom}
 */
const documentAtomWithId = id => {
  if (!id) {
    return emptyAtom
  }

  return isSessionId(id) ? sessionAtomWithId(id) : snippetAtomWithId(id)
}

/**
 * Write code, and the caret, into whichever document the id names: the store
 * and the connection's file for a snippet, this window alone for a session.
 */
const writeCodeAtom = atom(null, (get, set, {id, code, position}) => {
  if (isSessionId(id)) {
    set(sessionsAtom, sessions => sessions.map(
      session => (session.id === id ? {...session, code, position} : session),
    ))
    return
  }

  set(updateSnippetAtom, {id, code, position})
})

/**
 * The session the root route shows, which is the one the window last started or
 * opened a tab on. It is held as an id rather than as the session itself, so
 * closing that session does not leave the window pointing at a copy of it: a
 * session that is gone falls back to the first one the window still has, and to
 * nothing when it has none.
 */
const activeSessionIdAtom = atom(null)

const activeSessionAtom = atom(get => {
  const sessions = get(sessionsAtom)

  return sessions.find(session => session.id === get(activeSessionIdAtom)) || sessions[0] || null
})

/**
 * Start a session and bring the window to it: what a + does, and the only way a
 * session comes to exist. Nothing is written to the connection, so the tab bar
 * is the only place it shows.
 */
const addSessionAtom = atom(null, (get, set, session) => {
  set(sessionsAtom, sessions => [...sessions, session])
  set(activeSessionIdAtom, session.id)
})

/**
 * Drop a session, and with it the code in it: closing its tab, or naming it as
 * a snippet, is the end of it. The window is left with no session rather than
 * with a fresh empty one when that was the last — what the root route does with
 * an empty window is the tab bar's to decide, and it starts a session there.
 */
const removeSessionAtom = atom(null, (get, set, id) => {
  set(sessionsAtom, sessions => sessions.filter(session => session.id !== id))

  if (get(activeSessionIdAtom) === id) {
    set(activeSessionIdAtom, null)
  }
})

/**
 * Make sure the window has a session to fall back to: the root route is a
 * document, and an editor with no document in it is an editor with nothing to
 * run, which the app never leaves you in. What this reads is the list at the
 * moment it is asked rather than at the moment the caller rendered — the last
 * session has just gone by then, and the caller's own copy of the list still
 * has it.
 */
const ensureSessionAtom = atom(null, (get, set) => {
  if (!get(sessionsAtom).length) {
    set(addSessionAtom, newSession())
  }
})

export {
  newSession,
  isSessionId,
  sessionsAtom,
  sessionAtomWithId,
  documentAtomWithId,
  writeCodeAtom,
  activeSessionIdAtom,
  activeSessionAtom,
  addSessionAtom,
  removeSessionAtom,
  ensureSessionAtom,
}
