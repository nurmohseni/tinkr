const {
  containerList, containersIn, projectDirsCommand, projectDirsIn, containerRead, containerDir,
  kubeContextsCommand, kubeNamespacesCommand, kubeNamesIn,
} = require('tinkr-core')

const {exec} = require('../remote')

// a listing is one line per container, and a machine with a great many is still
// one answer: the cap is what says an answer this large is not a picker's
const maxAnswer = 256 * 1024

// how long a machine is given to say what it runs. A server that is there
// answers at once; one that is slow to start its engine is still worth waiting
// for, and one that has gone is not worth waiting on for longer than this
const timeout = 20000

/**
 * The shell that reads a line the machine runs.
 *
 * The line runs where the engine is, so it is read by that machine's shell: the
 * far login shell for a connection over ssh, which is posix on every host this
 * app reaches, and this machine's — cmd when the app is on windows — for a local
 * one.
 *
 * @param {Record<String, any>} connection
 * @return {String}
 */
const shellOf = connection => (connection && connection.is_over_ssh ? 'posix' : process.platform)

/**
 * A question put to the machine a connection reaches, and what it printed.
 *
 * A machine that could not be reached, an engine that would not run and one that
 * printed nothing are the same answer here: there is nothing to offer. The form
 * is a form either way, and a name typed by hand is still a name it uses.
 *
 * @param {Record<String, any>} connection
 * @param {String} command
 * @return {Promise<String|null>} what it printed, or null when it did not answer
 */
const ask = async (connection, command) => {
  try {
    const answer = await exec(connection, command, {timeout, maxBuffer: maxAnswer})

    return answer.code === 0 ? answer.stdout : null
  } catch (e) {
    return null
  }
}

/**
 * What an engine is running on the machine a connection reaches.
 *
 * A container's name is not something to type: a compose file and a PaaS name
 * one per deploy (`app-abc123`), so a name saved in a connection is stale after
 * the next one. What the form offers is what is running now, which is what a
 * session has to reach.
 *
 * The listing runs where the engine runs. For a local connection that is this
 * machine; for one over ssh it is the far side, reached the way a session
 * reaches it, so a password connection answers here too.
 *
 * A machine that cannot list — no engine, an engine with no permission, a
 * server that is not there — answers with nothing rather than an error: the
 * form says there is none to pick, and what was typed by hand still works.
 *
 * @param {Record<String, any>} connection with `container_engine`, and the ssh
 *   fields when the project is on another machine
 * @return {Promise<Array<{name: String, image: String}>>}
 */
const containers = async connection => {
  const engine = connection && connection.container_engine
  // the listing is read by the shell of the machine the engine is on: the far
  // login shell for a connection over ssh, and this machine's — cmd when the app
  // is on windows — for a local one
  const listing = containerList(engine, shellOf(connection), connection)

  if (!listing) {
    return []
  }

  const answer = await ask(connection, listing)

  return answer ? containersIn(answer) : []
}

/**
 * The directories inside a container that look like a php project.
 *
 * A deployed project is somewhere under the container's own files, and asking
 * someone to type its path is asking for a guess. What is offered is what can be
 * recognized without knowing the project — a directory holding a `composer.json`
 * or an `artisan` — plus the directory the engine already starts in.
 *
 * @param {Record<String, any>} connection with the container fields
 * @param {String} [root] where to start looking, and otherwise the container's
 *   own idea of the project's directory
 * @return {Promise<Array<String>>}
 */
const projectDirs = async connection => {
  const root = containerDir(connection) || '/'
  // the question is read by the container's own shell, and the engine's line
  // around it by the machine's: containerRead quotes each for its own side
  const question = projectDirsCommand(root)
  const inside = containerRead(connection, question)

  if (!inside) {
    return []
  }

  const answer = await ask(connection, inside)

  return answer === null ? [] : projectDirsIn(answer)
}

/**
 * The contexts the connection's kubeconfig names.
 *
 * A pod is not always in the cluster the current context reaches, and a context
 * is a name nobody should have to recall: what the form offers is what the file
 * holds. The question is asked of the same machine the listing is, and a machine
 * that cannot answer offers nothing, which leaves the field typeable.
 *
 * @param {Record<String, any>} connection with `kube_config` when the file is not
 *   the default one, and the ssh fields when kubectl is on another machine
 * @return {Promise<Array<String>>}
 */
const contexts = async connection => {
  const answer = await ask(connection, kubeContextsCommand(connection, shellOf(connection)))

  return answer === null ? [] : kubeNamesIn(answer)
}

/**
 * The namespaces the connection's cluster has.
 *
 * @param {Record<String, any>} connection with the kubectl fields, and the ssh
 *   fields when kubectl is on another machine
 * @return {Promise<Array<String>>}
 */
const namespaces = async connection => {
  const answer = await ask(connection, kubeNamespacesCommand(connection, shellOf(connection)))

  return answer === null ? [] : kubeNamesIn(answer)
}

module.exports = {
  containers,
  projectDirs,
  contexts,
  namespaces,
}
