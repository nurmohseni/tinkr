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
