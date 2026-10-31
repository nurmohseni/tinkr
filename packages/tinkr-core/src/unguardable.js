/**
 * The statements in a run that a dry run's transaction cannot take back.
 *
 * A dry run is one transaction on the default connection, taken back when the
 * run is done, and some statements are out of its reach: MySQL commits
 * everything before and including DDL on its own, the snippet's own commit or
 * rollback closes the transaction it was handed, a reconnect or purge drops it
 * with the connection, and another connection was never inside it. The app asks
 * about those before a run on a production connection, and the MCP server
 * refuses them when the app's production mode forces a sandbox, because the
 * sandbox is no protection there either.
 *
 * It is a scan of the text, not a parse of it, for the same reason the app's own
 * scan is: the run is PHP that exists as a string until the session evals it.
 * The patterns are the ones the app's renderer uses (see
 * packages/tinkr-renderer/src/utils/mutationScan.js), and a unit test there
 * compares the two so a pattern added to one is added to the other.
 */

const UNGUARDABLE = [
  // the schema facade is DDL whatever it is asked
  ['ddl', /\b(Schema::\w+)/g],
  // DDL as SQL, in a statement or in any string
  ['ddl', /\b(create\s+(?:temporary\s+)?(?:table|index|unique\s+index|view|database|schema|trigger|procedure|function)|alter\s+table|drop\s+(?:table|index|view|database|schema|trigger|procedure|function)|rename\s+table|truncate)\b/gi],
  // the query builder's own truncate, which is DDL on MySQL
  ['ddl', /(?:->|::)(truncate)\s*\(/g],
  // a schema migration is DDL run by a command
  ['ddl', /Artisan::call\s*\(\s*['"]((?:migrate|db:wipe|schema:)[\w:.-]*)/g],
  // the snippet closing or opening a transaction itself
  ['transaction', /(?:->|::)(commit|rollBack|rollback|beginTransaction)\s*\(/g],
  // the same as SQL, at the start of a string a statement was handed
  ['transaction', /['"]\s*(commit|rollback|start\s+transaction|begin)\b/gi],
  // another connection: named, or picked for a model or a query. A bare
  // `connection()` is the default one, which is the one being guarded, and
  // `->on(` is left out because it is also a join's condition; `Model::on(` is
  // the model on another connection
  ['connection', /(?:(?:->|::)(connection|setConnection|onConnection|usingConnection)|::(on))\s*\((?!\s*\))/g],
  // the connection dropped and made again, and the transaction with it
  ['reconnect', /(?:->|::)(reconnect|purge|disconnect|setPdo)\s*\(/g],
  // the default connection swapped for another while the run is going
  ['config', /(?:\bconfig\s*\(\s*\[|Config::set\s*\(|config\(\)\s*->\s*set\s*\()[^;]*?(database\.default)/g],
]

/**
 * What each reason is, said in a sentence a run's answer can carry.
 *
 * @type {Object<String, String>}
 */
const unguardableReasons = {
  ddl: 'DDL, which MySQL commits on its own',
  transaction: 'a transaction the code closes itself',
  connection: 'a database connection other than the guarded one',
  reconnect: 'a connection dropped and made again',
  config: 'the default connection swapped while the run goes',
}

/**
 * The statements in a run that a dry run's transaction cannot take back, each
 * at the line it starts on: `{line, call, reason}`, where the reason is one of
 * `ddl`, `transaction`, `connection`, `reconnect` or `config`.
 *
 * @param {String} code
 * @return {Array}
 */
const unguardableScan = code => {
  const text = String(code ?? '')
  const found = new Map()

  UNGUARDABLE.forEach(([reason, pattern]) => {
    const search = new RegExp(pattern.source, pattern.flags)
    let match = search.exec(text)

    while (match) {
      const line = text.slice(0, match.index).split('\n').length
      // the first group that matched: a pattern with alternatives has one each
      const call = match.slice(1).find(Boolean).replace(/\s+/g, ' ')
      const key = `${line}:${reason}`

      // one entry per reason a line has: `Schema::create` and the `create
      // table` it would print are the same statement
      if (!found.has(key)) {
        found.set(key, {line, call, reason})
      }

      match = search.exec(text)
    }
  })

  return [...found.values()].sort((a, b) => a.line - b.line)
}

module.exports = {UNGUARDABLE, unguardableReasons, unguardableScan}
