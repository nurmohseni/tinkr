import {atom} from 'jotai'
import {atomWithImmer} from 'jotai-immer'

import {
  allConnections,
  connectConnection,
  createConnection,
  deleteConnection,
  updateConnection,
} from '../utils/api'

const connectionDataAtom = atomWithImmer(allConnections())

const connectionListAtom = atom(get => Object.values(get(connectionDataAtom)))

const createConnectionAtom = atom(null, (get, set, connection) => {
  set(connectionDataAtom, data => {
    data[connection.id] = connection
  })

  createConnection(get(connectionDataAtom)[connection.id])
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
  createConnectionAtom,
  connectConnectionAtom,
  deleteConnectionAtom,
  updateConnectionAtom,
  connectionAtomWithId,
}
