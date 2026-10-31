const {
  isCloud,
  isExplainable,
  explainSql,
  normalizeBindings,
  phpString,
} = require('tinkr-core')

const {getEditorConnection, getBackgroundPtyProcess} = require('./processes')
const {ensureBackgroundPty} = require('./createBackgroundPty')

/**
 * The plan of a query a run already sent, read out of band.
 *
 * The plan is asked of the connection's background session — the one the code
 * popup asks for reflection — rather than the tab's session: asking the tab's
 * session would put the `EXPLAIN` in the middle of what the person is running,
 * and a plan is not part of their snippet. Nothing here is a run: no history
 * row is written, no transaction is opened, and the tab's session is untouched.
 *
 * A plan belongs to a driver, not to a statement: sqlite calls it `EXPLAIN QUERY
 * PLAN`, everything else here calls it `EXPLAIN`. The driver is the connection's
 * own answer, asked once and kept for as long as the background session is the
 * same one. A session that is replaced is a new session, and its driver is asked
 * again — a connection can be switched to another database without the window
 * knowing.
 *
 * The query is explained with the bindings the run captured, so the plan is the
 * plan of the statement that ran rather than one guessed at with placeholders
 * left in. `EXPLAIN ANALYZE` is never used: it runs the statement, and a plan is
 * supposed to leave the database as it found it.
 */

/**
 * The php that asks a connection what driver it is.
 *
 * `getDriverName` is Laravel's own answer; a connection object that does not
 * have it is asked through its PDO, and a config with neither is read from
 * `config()`. Whatever answers is lowercased where it is used, so a driver
 * spelled the way a config spells it is still the driver.
 *
 * @param {String|null} name  the laravel connection name, or null for the default
 * @return {String}
 */
const driverCode = name => 'function(){' +
  `$tinkr_name=${name ? phpString(name) : 'null'};` +
  "$tinkr_db=app('db')->connection($tinkr_name);" +
  '$tinkr_driver=null;' +
  "if(method_exists($tinkr_db,'getDriverName')){$tinkr_driver=$tinkr_db->getDriverName();}" +
  "if(!$tinkr_driver&&method_exists($tinkr_db,'getPdo')){" +
  '$tinkr_driver=$tinkr_db->getPdo()->getAttribute(\\PDO::ATTR_DRIVER_NAME);}' +
  'if(!$tinkr_driver){' +
  "try{$tinkr_configured=method_exists($tinkr_db,'getName')?$tinkr_db->getName():$tinkr_name;" +
  "$tinkr_driver=config('database.connections.'.($tinkr_configured?:config('database.default')).'.driver');}" +
  'catch(\\Throwable $tinkr_config_failure){$tinkr_driver=null;}}' +
  "if(!$tinkr_driver){throw new \\RuntimeException('the connection does not say what driver it runs');}" +
  "return ['driver'=>(string)$tinkr_driver];" +
  '}'

/**
 * The php that asks for the plan of one statement, with the bindings it ran with.
 *
 * The bindings travel as json and are decoded in the session: php's own array
 * syntax would need every string escaped twice — once for the string and once
 * for the line the session is typed — and json is the same code whatever the
 * bindings are.
 *
 * @param {String|null} name
 * @param {String} sql  the statement to ask about, already prefixed for the driver
 * @param {Array} bindings
 * @return {String}
 */
const planCode = (name, sql, bindings) => 'function(){' +
  `$tinkr_name=${name ? phpString(name) : 'null'};` +
  "$tinkr_db=app('db')->connection($tinkr_name);" +
  `$tinkr_bindings=json_decode(${phpString(JSON.stringify(normalizeBindings(bindings)))},true);` +
  `$tinkr_rows=$tinkr_db->select(${phpString(sql)},is_array($tinkr_bindings)?$tinkr_bindings:[]);` +
  'return ["plan"=>array_map(function($tinkr_row){return (array)$tinkr_row;},$tinkr_rows)];' +
  '}'

/**
 * What each background session has answered about its drivers, per connection
 * name. The key is the session, so a session that is replaced cannot answer for
 * the one that replaced it.
 *
 * @type {WeakMap<Object, Map<String, Promise<String>>>}
 */
const drivers = new WeakMap()

/**
 * The driver a connection runs, as the session answers it once.
 *
 * @param {Object} pty
 * @param {String|null} name
 * @return {Promise<String>}
 */
const driverOf = (pty, name) => {
  let cache = drivers.get(pty)

  if (!cache) {
    cache = new Map()
    drivers.set(pty, cache)
  }

  const key = name || ''

  if (!cache.has(key)) {
    const asked = pty.jsonResult(driverCode(name)).then(raw => {
      const answer = JSON.parse(raw)

      if (!answer || !answer.driver) {
        throw new Error('the connection did not say what driver it runs')
      }

      return String(answer.driver)
    }).catch(error => {
      // not an answer at all: the next request asks the session that is there
      // then, rather than reading a failure as a driver for as long as it lives
      cache.delete(key)

      throw error
    })

    cache.set(key, asked)
  }

  return cache.get(key)
}

/**
 * The plan of one captured query, asked out of band.
 *
 * The renderer only offers this for a SELECT, and the rule is checked here too:
 * what the main process sends is decided by the main process.
 *
 * @param {String} connectionId  the editor's connection
 * @param {Object} request  `{connection, sql, bindings}`
 * @return {Promise<{driver: String, plan: Array<Object>}>}
 */
const explainQuery = async (connectionId, request = {}) => {
  const connection = getEditorConnection(connectionId)

  if (!connection) {
    throw new Error('the connection is not open')
  }

  // a command on Laravel Cloud is a command in the environment's history, on
  // production: a plan is not worth one, and the pane says so where the action
  // would be (see Queries.jsx)
  if (isCloud(connection)) {
    throw new Error('a plan is not asked of Laravel Cloud: the command would land in its history')
  }

  const sql = typeof request.sql === 'string' ? request.sql : ''

  if (!isExplainable(sql)) {
    throw new Error('only a SELECT asks for a plan')
  }

  ensureBackgroundPty(connectionId)

  const pty = getBackgroundPtyProcess(connectionId)

  if (!pty) {
    throw new Error('the session is not available, try reconnecting')
  }

  const name = request.connection || null
  const driver = await driverOf(pty, name)

  // the statement that asks for the plan, built outside the session so the rule
  // per driver is the same one the pane offers the action by
  const asked = explainSql(driver, sql)
  const answer = JSON.parse(await pty.jsonResult(planCode(name, asked, request.bindings)))

  return {
    driver: String(answer && answer.driver ? answer.driver : driver),
    plan: Array.isArray(answer && answer.plan) ? answer.plan : [],
  }
}

module.exports = {
  explainQuery,
  driverCode,
  planCode,
}
