const {openStore} = require('./store')

const {quickConnection} = require('../constants')

const connections = openStore({
  name: 'app/connections',
  defaults: {
    [quickConnection.id]: quickConnection,
  },
})

/**
 * The connection a session is booted with, as the store holds it.
 *
 * The window's form is not the connection: it is what was typed into it, and a
 * password in it has been written to the secret file by the time a session is
 * started from it. The store's copy is the one whose flag says a password is
 * kept, so a session boots from that — a draft confirmed with a password is one
 * session that would otherwise ask the terminal for it. A connection the store
 * does not hold is handed back as it came.
 *
 * @param {Record<String, any>} connection
 * @return {Record<String, any>}
 */
const sessionConnection = connection => {
  // the quick connection is a session, not a stored connection: the store holds
  // a placeholder for it, and reading it back would drop the directory the
  // folder button was just given
  if (connection && connection.id === quickConnection.id) {
    return connection
  }

  const stored = connection && connection.id ? connections.get(connection.id, null) : null

  return stored && stored.id ? stored : connection
}

module.exports = {
  connections,
  sessionConnection,
}
