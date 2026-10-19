const {containerList, containersIn, projectDirsCommand, projectDirsIn, containerRead, containerPath} = require('tinkr-core')

const {exec} = require('../remote')

// a listing is one line per container, and a machine with a great many is still
// one answer: the cap is what says an answer this large is not a picker's
const maxAnswer = 256 * 1024

// how long a machine is given to say what it runs. A server that is there
// answers at once; one that is slow to start its engine is still worth waiting
// for, and one that has gone is not worth waiting on for longer than this
const timeout = 20000

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
  const listing = containerList(engine)

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
  const root = containerPath(connection) || '/'
  const question = projectDirsCommand(root)
  const inside = containerRead(connection, question)

  if (!inside) {
    return []
  }

  const answer = await ask(connection, inside)

  return answer === null ? [] : projectDirsIn(answer)
}

module.exports = {
  containers,
  projectDirs,
}
