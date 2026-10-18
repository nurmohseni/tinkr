/**
 * Everything about running code that knows nothing about a window.
 *
 * The app's main process and the MCP server both run snippets through this, so
 * there is one implementation of the run protocol, one of what a session is
 * started with, and one of how a snippet's classes are resolved. The exports are
 * flat, because this is one small library and every consumer wants a handful of
 * names out of it.
 */
module.exports = Object.assign(
  {},
  require('./runResult'),
  require('./terminalOutput'),
  require('./classIndex'),
  require('./phpScanner'),
  require('./session'),
  require('./parseSSHCommand'),
  require('./containerCommand'),
)
