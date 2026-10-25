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
  require('./sshAskpass'),
  require('./sshControl'),
  require('./containerCommand'),
  require('./cloud'),
  require('./remote'),
  // a namespace rather than flat names: `files` and `read` are what a log
  // module calls its own, and the library already has plenty of those
  {logs: require('./logs')},
)
