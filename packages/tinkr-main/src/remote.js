const {exec: runCommand, quoted, ensureMaster: openMaster, closeMasters} = require('tinkr-core')

const {dataDir} = require('./utils/dataDir')

/**
 * Running a command on the machine a connection runs on, with the app's own data
 * directory.
 *
 * The command itself is core's, because the MCP server asks a project the same
 * questions the window does and both have to reach it the same way. What is the
 * app's alone is where its files are — electron answers that, and a connection's
 * saved password is read from there — so it is added here once rather than at
 * every call.
 */

/**
 * @param {Record<String, any>} connection
 * @param {String} command what to run there
 * @param {Object} [options] `timeout` for how long it gets to answer, and
 *   `maxBuffer` for how much of an answer to keep
 * @return {Promise<{stdout: String, stderr: String, code: Number|null}>}
 */
const exec = (connection, command, options = {}) => runCommand(
  connection,
  command,
  Object.assign({dataDir: dataDir()}, options),
)

/**
 * @param {Record<String, any>} connection
 * @return {Promise<Boolean>} whether a login to it is up
 */
const ensureMaster = connection => openMaster(connection, {dataDir: dataDir()})

module.exports = {
  quoted,
  exec,
  ensureMaster,
  closeMasters,
}
