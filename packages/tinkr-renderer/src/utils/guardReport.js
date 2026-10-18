/**
 * What the pane says about the transaction a guarded run was sent under, chosen
 * from the run's envelope: the sentence, its tone, the connections that were
 * outside the transaction, and whether keeping the run is offered.
 *
 * It is the one place the outcome is read, so the pane never says a run was
 * rolled back unless the guard says it was. A transaction that was no longer
 * open when the run ended (`broken`: MySQL committed on DDL, the snippet closed
 * it, the connection was dropped) is an error, because what the run did may
 * have been kept; a commit run that threw was taken back, and says nothing was
 * kept. Statements sent to other connections were never inside the transaction,
 * whichever way it ended, so they are listed on their own.
 *
 * Keeping is offered only for a dry run that was taken back, wrote something,
 * and finished without an error: a run that read was kept as it was, and a run
 * that threw would throw again.
 *
 * @param {Object} transaction  the envelope's `transaction`
 * @param {Object} run          `{error, queries, queriesTotal}` of the same run
 * @return {Object|null}  `{id, values, tone, unguarded: [{connection, count}],
 *                        unguardedId, keep}`, or null for an unguarded run
 */
/**
 * What the sandbox caught, as one sentence and the lines under it.
 *
 * A sandboxed dry run is the case this exists for: the transaction says nothing
 * is kept, and this says nothing was sent, pushed or written either. What a run
 * caught is a count per channel with the first few named, so the sentence stays
 * one line and the pane can list the rest.
 *
 * A channel that could not be swapped is the report's own warning: a dry run that
 * only looked sealed is worse than one that says it was not.
 *
 * @param {Object} sandbox  the envelope's `sandbox`
 * @return {Object|null}  `{id, values, tone, sent, requested, notSandboxed}`
 */
export const sandboxReport = sandbox => {
  if (!sandbox) {
    return null
  }

  const channels = sandbox.channels || {}
  const sent = Array.isArray(sandbox.sent) ? sandbox.sent : []
  const requested = Array.isArray(sandbox.requested) ? sandbox.requested : []
  const notSandboxed = Array.isArray(sandbox.not_sandboxed) ? sandbox.not_sandboxed : []
  const counted = Object.entries(channels)
    .filter(([, count]) => Number(count) > 0)
    .map(([name, count]) => ({name, count}))

  const summary = counted.length
    ? counted.map(({name, count}) => `${count} ${name}`).join(', ')
    : ''

  return {
    id: counted.length ? 'guard.sandbox_report' : 'guard.sandbox_nothing',
    values: {summary},
    // a run that could not seal a channel is a warning, and one that sealed
    // everything is the quiet success the dry run reports
    tone: notSandboxed.length ? 'error' : 'ok',
    sent,
    requested,
    notSandboxed,
  }
}

export const guardReport = (transaction, {error = null, queries = null, queriesTotal = 0} = {}) => {
  if (!transaction) {
    return null
  }

  const {mode, armed, connection, statements, outcome} = transaction
  const reason = transaction.error
  const values = {count: statements || 0, connection: connection || '', error: reason || ''}
  let id = 'guard.not_armed'
  let tone = 'error'

  if (outcome === 'committed') {
    id = 'guard.committed'
    tone = 'ok'
  } else if (outcome === 'rolledBack' && mode === 'commit') {
    id = 'guard.commit_threw'
    tone = 'error'
  } else if (outcome === 'rolledBack') {
    id = 'guard.rolled_back'
    tone = 'ok'
  } else if (outcome === 'broken') {
    id = reason ? 'guard.broken' : 'guard.broken_plain'
  } else if (outcome === 'failed' && armed) {
    id = 'guard.close_failed'
  } else if (reason) {
    id = 'guard.not_armed_because'
  }

  const unguarded = Object.entries(transaction.unguarded || {})
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({connection: name, count}))

  // a query the guarded connection was sent that is not a read. Without the
  // whole query log (none, or one cut at the storage limits) the count of
  // statements is all there is to go on
  const whole = Array.isArray(queries) && queriesTotal <= queries.length
  const wrote = whole
    ? queries.some(query => (!connection || !query.connection || query.connection === connection) &&
      !/^\s*\(?\s*(select|show|pragma|explain|describe|desc|with|set)\b/i.test(String(query.sql || '')))
    : (statements || 0) > 0

  return {
    id,
    values,
    tone,
    unguarded,
    unguardedId: mode === 'commit' ? 'guard.unguarded_commit' : 'guard.unguarded',
    keep: outcome === 'rolledBack' && mode !== 'commit' && !error && wrote,
  }
}
