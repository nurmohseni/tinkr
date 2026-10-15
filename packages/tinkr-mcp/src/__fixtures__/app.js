const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * A directory shaped the way Tinkr's own data is, for a test to read: the
 * connections and the preferences the app writes, and the snippets a connection
 * has.
 *
 * @param {{connections?: Object, command?: String, snippets?: Object}} [data]
 *   `connections` and `snippets` are keyed by id, as the app keeps them
 * @return {String} the directory the app would keep its files in
 */
const makeAppDir = ({connections = {}, command = null, snippets = {}} = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-mcp-'))
  const app = path.join(dir, 'app')

  fs.mkdirSync(path.join(app, 'snippets'), {recursive: true})
  fs.writeFileSync(path.join(app, 'connections.json'), JSON.stringify(Object.assign({
    quick_connection: {id: 'quick_connection', name: 'Quick Connection'},
  }, connections), null, '\t'))
  fs.writeFileSync(path.join(app, 'config.json'), JSON.stringify(
    command ? {command_default: command} : {},
    null,
    '\t',
  ))

  for (const [id, value] of Object.entries(snippets)) {
    fs.writeFileSync(path.join(app, 'snippets', `${id}.json`), JSON.stringify(value, null, '\t'))
  }

  return dir
}

const removeAppDir = dir => fs.rmSync(dir, {recursive: true, force: true})

/**
 * A connection, as the app stores one.
 *
 * @param {Object} [fields]
 * @return {Object}
 */
const connection = (fields = {}) => Object.assign({
  id: 'one',
  name: 'One',
  tag: 'local',
  is_over_ssh: false,
  path: '/tmp/project',
  command: '',
}, fields)

module.exports = {
  makeAppDir,
  removeAppDir,
  connection,
}
