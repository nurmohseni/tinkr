import {CELL_CHARS, truncate} from './resultReading'

/**
 * The query log as text: what leaves the pane that lists the queries a run
 * executed.
 *
 * What is copied is what the connection ran — the sql with the placeholders the
 * driver was given, and the bindings it was handed — so a paste into a client is
 * the same statement rather than one this app filled in. Filling placeholders in
 * would mean quoting for the driver, and only the driver knows how.
 *
 * @param {Array} queries  the queries, in the order they ran
 * @return {String}  every statement, terminated, one per line
 */
export const sqlText = queries => queries.map(query => `${query.sql};`).join('\n')

/**
 * One statement as the log writes it: the sql as it was sent, cut to what a cell
 * shows.
 *
 * It is not written the way a string leaf is — this is the statement the pane
 * exists to read, not a value inside a table of values, so it is not quoted.
 *
 * @param {String} sql
 * @return {Object}  {text, cut} — the full statement being what the cell's title
 *                   carries when it was cut
 */
export const sqlCell = sql => {
  const text = truncate(sql, CELL_CHARS)

  return {text, cut: text !== sql}
}

/**
 * One query whole, as json: the line of the snippet that sent it, the sql, the
 * bindings, what it took and the connection it ran on.
 *
 * @param {Object} query
 * @return {String}
 */
export const queryText = query => JSON.stringify(query, null, 2)

// a plan is a table of the database's own words: a step's detail is read in a
// cell, and a plan that is one long column — pgsql's — keeps its lines as lines
export const PLAN_CHARS = 400
const PLAN_TITLE_CHARS = 2000

/**
 * The rows of a plan as a table: the columns are every key the rows name, in
 * the order the rows first name them, because a driver is free to add one.
 *
 * @param {Array} plan  the rows the session answered with
 * @return {{columns: Array<String>, rows: Array<Object>}}
 */
export const planTable = plan => {
  const rows = Array.isArray(plan)
    ? plan.filter(row => row !== null && typeof row === 'object' && !Array.isArray(row))
    : []
  const columns = []

  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (!columns.includes(name)) {
        columns.push(name)
      }
    }
  }

  return {columns, rows}
}

/**
 * One plan cell: what the table shows, and what the tooltip carries when it is
 * longer than the column. A plan value is the database's, not a json value, so
 * a string is written as itself rather than quoted.
 *
 * @param {any} value
 * @return {{text: String, full: String, cut: Boolean}}
 */
export const planCell = value => {
  if (value === null || value === undefined) {
    return {text: '', full: '', cut: false}
  }

  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const shown = truncate(text, PLAN_CHARS)

  return {text: shown, full: truncate(text, PLAN_TITLE_CHARS), cut: shown !== text}
}
