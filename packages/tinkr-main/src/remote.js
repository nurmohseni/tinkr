const {spawn} = require('child_process')
const {app} = require('electron')

const {sshArgs, askpassEnvironment, inContainer} = require('tinkr-core')

// how long a connection is given to answer before it is taken as one that
// cannot: a machine that is there answers in a moment, one that is not never
// will
const defaultTimeout = 10000

/**
 * Where the app's data is, which is where a connection's saved password is.
 *
 * It is asked for here rather than passed down: every caller of this file is a
 * question about a project, and a question is not a place to thread a directory
 * through. A test that has no electron gets nothing, and a connection without a
 * password never asks for it.
 *
 * @return {String|null}
 */
const askpassDir = () => {
  try {
    return app.getPath('userData')
  } catch (e) {
    return null
  }
}

/**
 * A value as one word of a shell reads it.
 *
 * The far end of an ssh run is a shell — ssh joins what it is given into one
 * line and hands that line over — so what travels to it has to be one word
 * already: the path of a connection, and the php a question is put in, are
 * quoted as units rather than written into a line a shell could break apart.
 *
 * @param {String} value
 * @return {String}
 */
const quoted = value => `'${String(value).replace(/'/g, "'\\''")}'`

/**
 * Run a command on the machine a connection runs on, and answer with what it
 * said.
 *
 * Everything that runs things for a connection puts its questions to it, and a
 * connection is a project on this machine or one on another. A local project is
 * answered by a shell here, in the project's own directory; a project over ssh
 * is answered by a shell there, reached the same way a session reaches it.
 *
 * A non-zero exit is an answer — a directory that is not there, a file that has
 * gone — so nothing here rejects: what the command wrote, and what it exited
 * with, are both for the caller to read.
 *
 * @param {Record<String, any>} connection
 * @param {String} command what to run there
 * @param {Object} [options]
 * @param {Number} [options.timeout] how long it gets to answer, in milliseconds
 * @param {Number} [options.maxBuffer] how much of an answer to keep
 * @return {Promise<{stdout: String, stderr: String, code: Number|null}>}
 */
const exec = (connection, command, {timeout = defaultTimeout, maxBuffer} = {}) => new Promise(resolve => {
  const project = (connection && connection.path) || ''
  // the command is one word of the shell there, and so is the directory it is
  // run in: nothing else of the connection goes into the line.
  //
  // A project in a container is not in the machine's directory: `path` is where
  // the machine keeps it, and the container sees it somewhere of its own — or
  // nowhere, when the image holds it. So a container's command carries its own
  // `cd`, inside the container (see containerRead), and one put outside it would
  // be a directory that need not exist here and means nothing there
  const remote = !project || inContainer(connection)
    ? command
    : `cd ${quoted(project)} && ${command}`

  // a connection with a saved password is answered by the app's own helper,
  // which is what makes a one-off question as logged-in as a session is. One
  // without a password is spawned exactly as it always was, so nothing of the
  // environment changes under it
  const askpass = connection && connection.is_over_ssh
    ? askpassEnvironment(askpassDir(), connection)
    : null

  const child = connection && connection.is_over_ssh
    ? spawn('ssh', [...sshArgs(connection), remote], ...(askpass
      ? [{env: Object.assign({}, process.env, askpass.env)}]
      : []))
    : spawn('/bin/sh', ['-lc', command], {cwd: connection && connection.path})

  const cap = maxBuffer === undefined ? Infinity : maxBuffer

  let stdout = ''
  let stderr = ''
  let timer = null
  let done = false

  // a command that was killed wrote what it wrote, and that is the answer: a
  // connection that did not finish is one the caller hears nothing more from
  const finish = code => {
    if (done) {
      return
    }

    done = true

    clearTimeout(timer)

    resolve({stdout, stderr, code})
  }

  // an answer nobody will read in full is not one to keep in memory in full
  const room = chunk => {
    if (stdout.length + stderr.length + chunk.length <= cap) {
      return true
    }

    child.kill()
    finish(null)

    return false
  }

  child.stdout.on('data', chunk => {
    if (room(chunk)) {
      stdout += chunk
    }
  })

  child.stderr.on('data', chunk => {
    if (room(chunk)) {
      stderr += chunk
    }
  })

  child.on('error', error => {
    // a machine that could not be reached at all is one with nothing to say
    stderr += String(error.message || error)
    finish(null)
  })

  child.on('close', code => finish(code))

  if (timeout > 0) {
    timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, timeout)
  }
})

module.exports = {
  defaultTimeout,
  quoted,
  exec,
}
