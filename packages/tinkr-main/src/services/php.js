const {isApiRun, quoted, inContainer, containerRead} = require('tinkr-core')

const {instance} = require('../dynamicPhpForm')
const {getEditorConnection} = require('../processes')
const {exec} = require('../remote')

// a question can carry a project's whole index, or the members of a large class,
// and an answer is read whole or not at all: it is capped high, and given the time
// a cold machine needs to answer it
const maxAnswer = 8 * 1024 * 1024
const answerTimeout = 30000

/**
 * Ask the machine a connection runs on a question in php, and answer with what
 * it printed.
 *
 * A host that runs a snippet is a host with php, which is the one thing the two
 * machines are known to have in common, and php reads no configuration to be
 * asked: one `php -r` per question, run in the project's own directory, is the
 * whole of it (see remote.exec). What comes back is the answer itself, and
 * nothing at all when the machine did not answer — an exit that is not zero, a
 * silence, an answer too large to keep — because a machine that does not answer
 * is not one holding an empty answer.
 *
 * @param {Record<String, any>} connection
 * @param {String} code the php to run
 * @param {{maxBuffer?: Number, timeout?: Number}} [options] what the answer may cost
 * @return {Promise<String|null>}
 */
const ask = async (connection, code, options = {}) => {
  // the php is read by the shell of whatever machine runs it, and the question is
  // built before anything knows which one that is: a container's php is read by
  // the container's own posix `sh`, and one behind ssh by the far login shell,
  // while a local read is read by this machine's shell — cmd when the app is on
  // windows. Only the local one is quoted for this platform (see
  // shell.connectionShell and containerRead, which re-quotes the outer layer)
  const inner = inContainer(connection) || (connection && connection.is_over_ssh)
    ? 'posix'
    : process.platform
  const question = `php -r ${quoted(code, inner)}`
  // a project in a container has its php in the container: the question is asked
  // there, in the project's own directory, because the machine may hold none of
  // the files at all (see containerRead)
  const inside = containerRead(connection, question)

  const answer = await exec(
    connection,
    inside || question,
    {maxBuffer: maxAnswer, timeout: answerTimeout, ...options},
  )

  return answer.code === 0 ? answer.stdout : null
}

const parsePhpForm = async (connectionId, code) => {
  // a connection that runs through an API has no session to ask, and nothing of
  // the form is worth a command there: the fields are read from the code itself,
  // and a closure field is the error the form shows (see DynamicPhpForm#parse).
  // No background session is booted for it, because there is none to boot.
  if (!isApiRun(getEditorConnection(connectionId))) {
    // a run boots a new session, so the background session may be gone by now
    // (required here rather than above: booting one reads the project's index, and
    // the project asks this module its own questions)
    require('../createBackgroundPty').ensureBackgroundPty(connectionId)
  }

  const form = await instance()

  return form.parse(connectionId, code)
}

// the form writes its values into the code it was read from, and a form sent
// without that code is written into nothing, so the code is kept with it
const stringifyPhpForm = async (fields, code) => {
  const form = await instance()

  if (code !== undefined) {
    form.code = code
  }

  return form.stringify(fields)
}

module.exports = {
  ask,
  parsePhpForm,
  stringifyPhpForm,
}
