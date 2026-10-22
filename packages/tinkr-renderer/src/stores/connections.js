import {atom} from 'jotai'
import {atomWithImmer} from 'jotai-immer'

import {
  allConnections,
  allHistory,
  allSnippets,
  connectConnection,
  createConnection,
  deleteConnection,
  getConnection,
  updateConnection,
} from '../utils/api'
import {activeDocumentAtom, connectionAtom, runsAtom, inFlightAtom} from './editor'
import {historyListAtom} from './history'
import {aiThreadAtom} from './ai'
import {activeSessionIdAtom, isSessionId, newSession, sessionsAtom} from './sessions'
import {snippetDataAtom} from './snippets'
import {openTabsAtom} from './tabs'
import {emptyLogs, logsAtom} from './logs'
import withoutPassword from '../utils/withoutPassword'

const connectionDataAtom = atomWithImmer(allConnections())

const connectionListAtom = atom(get => Object.values(get(connectionDataAtom)))

const createConnectionAtom = atom(null, (get, set, connection) => {
  // the password the form was holding is the main process's to keep, and the
  // window keeps the connection without it (see withoutPassword). The main
  // process is given the form as it is, because the password is only ever in the
  // form: a connection created with one would otherwise be written without it
  const stored = withoutPassword(connection)

  set(connectionDataAtom, data => {
    data[stored.id] = Object.assign({}, stored, {
      ssh_password: typeof connection.password === 'string' && connection.password !== '',
    })
  })

  createConnection(connection)
})

/**
 * What each connection's window was holding, by connection id: the documents
 * that were open, their code and the answers they last gave, and the run that
 * was going when the window moved away.
 *
 * A connection is a project, and a document is about that project. Leaving one
 * for another is not closing what was open in it: the sessions nobody has saved
 * anywhere live here, and losing them on a click in the sidebar would be losing
 * work the window never wrote down. The map lives here, beside the switch, and
 * is as long as the window is.
 *
 * @type {Map<String, Object>}
 */
const documentsOf = new Map()

/**
 * The route a connection's last document is on: the session the window was on
 * is the root, and a snippet is the route that names it.
 *
 * @param {String} document
 * @param {Object} snippets
 * @return {String}
 */
const pathOf = (document, snippets) => {
  if (!document || isSessionId(document) || !snippets[document]) {
    return '/'
  }

  return `/snippets/${document}/editor`
}

/**
 * Take the connection the main process switched this window to.
 *
 * The window was not loaded again for it, so everything that is a fact about a
 * connection has to be read again here: which connection the window is on, the
 * snippets and the history of that connection, and the documents, the runs and
 * the thread, which were the other connection's.
 *
 * What the window was holding goes into `documentsOf` under the connection it
 * was showing, and comes back when that connection is shown again: its tabs,
 * the code in them, the answers they last gave and the run that was going. What
 * is not about a connection is not touched: the preferences, the layout, the
 * theme, the window itself.
 *
 * @return {String} the route of the document the connection was last on
 */
const switchConnectionAtom = atom(null, (get, set) => {
  const left = get(connectionAtom)
  const next = getConnection()

  if (left && left.id) {
    documentsOf.set(left.id, {
      sessions: get(sessionsAtom),
      activeSessionId: get(activeSessionIdAtom),
      tabs: get(openTabsAtom),
      runs: get(runsAtom),
      inFlight: get(inFlightAtom),
      document: get(activeDocumentAtom),
    })
  }

  set(connectionAtom, next)
  set(snippetDataAtom, allSnippets())
  set(historyListAtom, allHistory())

  const kept = documentsOf.get(next.id)

  // a connection this window has not been on yet opens with one empty session
  set(sessionsAtom, kept ? kept.sessions : [newSession()])
  set(activeSessionIdAtom, kept ? kept.activeSessionId : null)
  set(openTabsAtom, kept ? kept.tabs : [])
  // every tab's run is the connection's own: the answers, the output and the
  // run that was going come back with it
  set(runsAtom, kept ? kept.runs : {})
  set(inFlightAtom, kept ? kept.inFlight : null)
  set(aiThreadAtom, [])
  // the logs were the other connection's project, and the panel reads the new
  // one's the moment it has none
  set(logsAtom, emptyLogs())

  return pathOf(kept && kept.document, get(snippetDataAtom))
})

/**
 * Connect to a connection, whichever dialog offered it.
 *
 * A dialog can be filling in a connection the store does not hold yet — a new
 * one, opened but not confirmed. There is no such connection anywhere until the
 * user connects to it, which is the confirmation that creates it: it is written
 * here, once, and the main process then switches the window's session to it.
 */
const connectConnectionAtom = atom(null, (get, set, connection) => {
  if (!get(connectionDataAtom)[connection.id]) {
    set(createConnectionAtom, connection)
  }

  // the main process is given the password: a draft that is connected is written
  // there with it, so the first session logs in the way the form says
  connectConnection(connection)
})

const deleteConnectionAtom = atom(null, (get, set, id) => {
  set(connectionDataAtom, data => {
    delete data[id]
  })

  deleteConnection(id)
})

const updateConnectionAtom = atom(null, (get, set, connection) => {
  // a connection the store does not hold is a draft, and a draft is written only
  // when it is confirmed: nothing of it is saved before that
  if (!get(connectionDataAtom)[connection.id]) {
    return
  }

  const stored = withoutPassword(connection)

  // what the window holds is the connection without the password; what it hands
  // the main process is what the form holds, so a password typed into the field
  // is kept and an untouched field changes nothing. A password typed here is one
  // the next session will have, so the window says one is kept — the main
  // process is the one that decides, and this is what the form shows until it
  // answers
  const typed = typeof connection.password === 'string' && connection.password !== ''

  set(connectionDataAtom, data => {
    data[stored.id] = Object.assign({}, data[stored.id], stored, {
      ssh_password: typed || Boolean(stored.ssh_password),
    })
  })

  updateConnection(connection)
})

const connectionAtoms = {}

const connectionAtomWithId = id => {
  if (!connectionAtoms[id]) {
    connectionAtoms[id] = atom(get => get(connectionDataAtom)[id])
  }

  return connectionAtoms[id]
}

export {
  connectionDataAtom,
  connectionListAtom,
  switchConnectionAtom,
  createConnectionAtom,
  connectConnectionAtom,
  deleteConnectionAtom,
  updateConnectionAtom,
  connectionAtomWithId,
}
