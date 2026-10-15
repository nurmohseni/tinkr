const {randomBytes} = require('crypto')

const {history} = require('../database/history')

// an entry carries the code that ran in full, so the list is capped instead of
// aged out: fifty runs of a scratchpad are already more than you can scan
const limit = 50

/**
 * How much of a run's own answer is kept with it.
 *
 * The file is read whole when a window switches to a connection, and a run can
 * answer with a table of rows or with the megabytes a `dump` printed. What does
 * not fit is left out and named in `cut`, so that an entry never reads as the
 * whole answer once it is not.
 */
const kept = 8 * 1024

/**
 * @param {any} value
 * @return {Number}
 */
const sizeOf = value => {
  try {
    return JSON.stringify(value).length
  } catch (e) {
    // a value json cannot carry is a value an entry cannot keep
    return kept + 1
  }
}

/**
 * What the run answered with, as much of it as an entry keeps.
 *
 * @param {Object|null} result the run envelope
 * @return {{value?: any, error?: Object, output?: String, cut?: Array<String>}}
 */
const answerOf = result => {
  if (!result) {
    return {}
  }

  const answer = {}
  const cut = []

  if (result.error) {
    answer.error = result.error
  }

  if (result.value !== null && result.value !== undefined) {
    if (sizeOf(result.value) <= kept) {
      answer.value = result.value
    } else {
      cut.push('value')
    }
  }

  if (result.output) {
    if (result.output.length <= kept) {
      answer.output = result.output
    } else {
      cut.push('output')
    }
  }

  if (cut.length) {
    answer.cut = cut
  }

  return answer
}

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
  const entry = Object.assign({
    id: randomBytes(8).toString('hex'),
    code,
    at: Date.now(),
    outcome: outcomeOf(result),
  }, answerOf(result))

  const entries = [entry, ...allHistory(connectionId)].slice(0, limit)

  history(connectionId).set('entries', entries)

  return entries
}

module.exports = {
  outcomeOf,
  answerOf,
  allHistory,
  clearHistory,
  appendHistory,
}
