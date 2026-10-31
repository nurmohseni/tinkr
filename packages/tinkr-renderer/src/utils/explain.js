/**
 * Which query rows offer a plan.
 *
 * The rule is the main process's rule (tinkr-core/src/explain.js): a row is
 * explainable when it is a `SELECT`. The renderer cannot import the core — the
 * core is the main process's library and pulls a pty with it — so the one line
 * of it a row needs is kept here. The two are tested against each other, which
 * is what keeps "the row offered it" and "the request was allowed" one rule.
 */

// whitespace, `--` comments, `#` comments (mysql) and block comments
const LEADING = /^(?:\s+|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/

/**
 * @param {String} sql
 * @return {Boolean}
 */
export const isExplainable = sql => typeof sql === 'string' &&
  /^select\b/i.test(sql.replace(LEADING, ''))
