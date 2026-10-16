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
