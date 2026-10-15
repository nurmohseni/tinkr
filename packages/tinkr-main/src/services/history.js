const {randomBytes} = require('crypto')

const {history} = require('../database/history')

// an entry carries the code that ran in full, so the list is capped instead of
// aged out: fifty runs of a scratchpad are already more than you can scan
const limit = 50

/**
 * What the run did, in the three things the run result can honestly say: it
 * returned a value, it only printed, or it threw.
 *
 * `result` is null when the session printed no envelope at all, which is a run
 * that returned nothing rather than one that failed.
 *
 * @param {Object|null} result
 * @return {String} `returned`, `printed` or `threw`
 */
const outcomeOf = result => {
  if (result && result.error) {
    return 'threw'
  }

  return result && result.value !== null && result.value !== undefined ? 'returned' : 'printed'
}

/**
 * @param {String} connectionId
 * @return {Array<Object>} the runs of the connection, newest first
 */
const allHistory = connectionId => history(connectionId).get('entries', [])

/**
 * Forget the runs of a connection.
 *
 * It is the list the sidebar draws and the store behind it: a connection that
 * has run nothing looks like one that never has, because that is what it now is.
 *
 * @param {String} connectionId
 * @return {Array<Object>} the list, which is empty
 */
const clearHistory = connectionId => {
  history(connectionId).set('entries', [])

  return allHistory(connectionId)
}

/**
 * Record a run: the code the session was given, when, and what it did.
 *
 * @param {String} connectionId
 * @param {String} code as the editor holds it, before the run wraps it
 * @param {Object|null} result
 * @return {Array<Object>} the list, newest first, as the sidebar draws it
 */
const appendHistory = (connectionId, code, result) => {
  const entry = {
    id: randomBytes(8).toString('hex'),
    code,
    at: Date.now(),
    outcome: outcomeOf(result),
  }

  const entries = [entry, ...allHistory(connectionId)].slice(0, limit)

  history(connectionId).set('entries', entries)

  return entries
}

module.exports = {
  outcomeOf,
  allHistory,
  clearHistory,
  appendHistory,
}
