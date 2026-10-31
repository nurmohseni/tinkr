/**
 * What an EXPLAIN is, and what may be explained.
 *
 * The app runs a plan for a query the run already sent, on the connection that
 * sent it: a read, sent on its own, so the answer is a plan and not a second
 * run of the snippet. The rule lives here because the renderer decides which
 * rows offer the action and the main process decides what it will actually
 * send — two readers of one rule, so they cannot disagree about a statement.
 *
 * Only a `SELECT` is explainable. A write is not a plan to read but a statement
 * the database would have to run to describe, and an `EXPLAIN` is a plan
 * already: asking for its plan is asking a second time. Leading whitespace and
 * the comments a hand-written statement may open with are not its first word.
 */

// whitespace, `--` comments, `#` comments (mysql) and block comments
const LEADING = /^(?:\s+|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/

/**
 * Whether a statement is a SELECT the app may ask a plan for.
 *
 * @param {String} sql
 * @return {Boolean}
 */
const isExplainable = sql => typeof sql === 'string' &&
  /^select\b/i.test(sql.replace(LEADING, ''))

/**
 * The statement that asks a driver for the plan of a SELECT.
 *
 * sqlite has no `EXPLAIN` of its own: what it calls a plan is `EXPLAIN QUERY
 * PLAN`, a different statement that returns one row per step. MySQL and
 * MariaDB answer `EXPLAIN`, and so does PostgreSQL. A driver this does not know
 * is refused rather than guessed at — a statement that is not a plan everywhere
 * is not one to send to a database nobody named.
 *
 * @param {String} driver  as the connection reports it: sqlite, mysql, mariadb, pgsql
 * @param {String} sql
 * @return {String}
 */
const EXPLAIN = {
  sqlite: 'EXPLAIN QUERY PLAN ',
  mysql: 'EXPLAIN ',
  mariadb: 'EXPLAIN ',
  pgsql: 'EXPLAIN ',
  postgres: 'EXPLAIN ',
  postgresql: 'EXPLAIN ',
}

const explainSql = (driver, sql) => {
  const prefix = EXPLAIN[String(driver || '').toLowerCase()]

  if (!prefix) {
    throw new Error(`EXPLAIN is not supported on the ${driver || 'unknown'} driver`)
  }

  return `${prefix}${sql}`
}

/**
 * The bindings a plan is asked with: the ones the query was sent with.
 *
 * A query the run captured always carries an array, but an envelope written by
 * something else — an old history row, an editor's own answer — may carry
 * nothing. Nothing is an empty list of bindings, not a binding of `undefined`.
 *
 * @param {any} bindings
 * @return {Array}
 */
const normalizeBindings = bindings => (Array.isArray(bindings) ? bindings : [])

module.exports = {
  isExplainable,
  explainSql,
  normalizeBindings,
}
