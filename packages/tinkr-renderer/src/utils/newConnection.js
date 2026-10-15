import {nanoid} from 'nanoid'

/**
 * The id the dialog is opened on for a connection that does not exist yet.
 *
 * A stored connection's id is a nanoid, so this one can never be one of them:
 * the dialog reads it as "a new connection, still unsaved", and the store keeps
 * no record of it.
 */
const newConnectionId = 'new'

/**
 * A new connection as the design opens its dialog on: the defaults, in memory
 * only. Nothing writes it anywhere until the dialog is confirmed, so cancelling
 * a dialog leaves the store exactly as it was.
 *
 * @param {String} name the default name, which the caller reads from the locale
 * @returns {Record<string, any>}
 */
const newConnection = name => ({
  id: nanoid(),
  tag: 'local',
  name,
  is_over_ssh: false,
  path: '',
  command: '',
})

export {newConnectionId, newConnection}
