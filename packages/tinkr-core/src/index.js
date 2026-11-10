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
  require('./redact'),
  require('./terminalOutput'),
  require('./classIndex'),
  require('./phpScanner'),
  require('./session'),
  require('./parseSSHCommand'),
  require('./sshAskpass'),
  require('./sshControl'),
  require('./containerCommand'),
  require('./unguardable'),
  require('./remoteCommand'),
  require('./cloud'),
  require('./vapor'),
  require('./remote'),
  require('./explain'),
  // what the editor knows about a name without running anything: the members of a
  // model, a class or a facade, and the types that follow from them
  require('./intelScript'),
  require('./modelIntel'),
  require('./classIntel'),
  require('./memberRank'),
  require('./typeInference'),
  require('./stringContexts'),
  // namespaces rather than flat names: `files`, `read` and `parse` are what other
  // modules call their own, and the library already has plenty of those
  {logs: require('./logs'), docblock: require('./docblock')},
)
