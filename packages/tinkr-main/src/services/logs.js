const {logs: reader} = require('tinkr-core')

const {config} = require('../database/config')
const {dataDir} = require('../utils/dataDir')

/**
 * The application's log files, for the app's own window.
 *
 * The reading is core's, because the MCP server reads the same files and both
 * have to see the same entries. What is the app's alone is where the preferences
 * are and where its data directory is: a project can keep its logs somewhere
 * other than `storage/logs`, and a connection's saved password is read from the
 * app's data.
 */

/**
 * What a read of a connection's logs needs from the app.
 *
 * @return {{logDir: String, dataDir: String|null}}
 */
const settings = () => ({
  logDir: config.get('log_dir', '') || reader.defaultDir,
  dataDir: dataDir(),
})

module.exports = {
  files: connection => reader.files(connection, settings()),
  read: (connection, name, options) => reader.read(connection, name, options, settings()),
}
