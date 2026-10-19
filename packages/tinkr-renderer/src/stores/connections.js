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
import {connectionAtom, runsAtom, inFlightAtom} from './editor'
import {historyListAtom} from './history'
import {aiThreadAtom} from './ai'
import {activeSessionIdAtom, newSession, sessionsAtom} from './sessions'
import {snippetDataAtom} from './snippets'
import {openTabsAtom} from './tabs'
import {emptyLogs, logsAtom} from './logs'

const connectionDataAtom = atomWithImmer(allConnections())

const connectionListAtom = atom(get => Object.values(get(connectionDataAtom)))

const createConnectionAtom = atom(null, (get, set, connection) => {
  set(connectionDataAtom, data => {
    data[connection.id] = connection
  })

  createConnection(get(connectionDataAtom)[connection.id])
})

/**
 * Take the connection the main process switched this window to.
 *
 * The window was not loaded again for it, so everything that is a fact about a
 * connection has to be read again here: which connection the window is on, the
 * snippets and the runs of that connection, the documents the window had open —
 * they were the other connection's, and its code with them — the session the
 * terminal was on, and the result and the thread, which were about code from
 * somewhere else.
 *
 * What is not about a connection is not touched: the preferences, the layout,
 * the theme, the window itself.
 */
const switchConnectionAtom = atom(null, (get, set) => {
  set(connectionAtom, getConnection())
  set(snippetDataAtom, allSnippets())
  set(historyListAtom, allHistory())
  set(sessionsAtom, [newSession()])
  set(activeSessionIdAtom, null)
  set(openTabsAtom, [])
  // every tab's run was a run of the connection that has just been left: its
  // answers, its output and the run that was going are not the new one's
  set(runsAtom, {})
  set(inFlightAtom, null)
  set(aiThreadAtom, [])
  // the logs were the other connection's project, and the panel reads the new
  // one's the moment it has none
  set(logsAtom, emptyLogs())
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

  set(connectionDataAtom, data => {
    data[connection.id] = connection
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
