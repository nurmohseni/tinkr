/**
 * Running a command on the machine a connection runs on.
 *
 * It is a question the app and the MCP server both put to a project: one
 * implementation, so a read the window makes and a read an agent makes reach the
 * same machine the same way, with the same login, the same directory and the
 * same password.
 *
 * Where the app's data is is not asked for here — the app knows it from electron
 * and the MCP server from its own arguments — so it is passed in as `dataDir`,
 * and it is the directory a connection's saved password is read from. A caller
 * that has none (a test, a project with no saved connection) leaves it out, and
 * a connection without a password never asks for it.
 */
const {spawn} = require('child_process')

const {sshArgs} = require('./parseSSHCommand')
const {controlPath} = require('./sshControl')
const {askpassEnvironment} = require('./sshAskpass')
const {inContainer} = require('./containerCommand')

// how long a connection is given to answer before it is taken as one that
// cannot: a machine that is there answers in a moment, one that is not never
// will
const defaultTimeout = 10000

// how long a stopped command is given to go away on its own before what is
// left of it — a descendant that ignores the TERM, say — is killed
const escalationTimeout = 1000

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
 * The connections whose master this process has started, by socket.
 *
 * It is what makes starting one a thing that happens once: everything that
 * reaches a connection asks for the master, and what it gets after the first ask
 * is the same login being waited on.
 *
 * @type {Map<String, {connection: Object, starting: Promise<Boolean>}>}
 */
const masters = new Map()

/**
 * Whether a master already answers on a socket.
 *
 * A socket can outlive the app that made it — an app that was killed, a window
 * that closed without quitting — and a login that is already there is one to
 * travel down rather than to make again. It is worth the one spawn it costs,
 * because asking ssh to become a master on a socket that is taken does not fail:
 * it silently stops multiplexing and sits on a connection of its own for as long
 * as `-N` says, which is a login nobody closes.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<Boolean>}
 */
const masterAnswers = connection => new Promise(resolve => {
  let child

  try {
    child = spawn('ssh', ['-O', 'check', ...sshArgs(connection)], {stdio: 'ignore'})
  } catch (e) {
    resolve(false)

    return
  }

  if (!child || typeof child.on !== 'function') {
    resolve(false)

    return
  }

  child.on('error', () => resolve(false))
  child.on('close', code => resolve(code === 0))
})

/**
 * Start the connection's master, or find the one already there.
 *
 * A connection over ssh is logged in to once and then travelled down (see
 * sshControl), and this is where that login is made. It is started by the app
 * rather than left to whichever command needed a connection first, because the
 * commands that come and go are killed when they are done, and a master killed
 * with them takes its socket with it.
 *
 * Every start is asked of the socket before it is made: a master ends itself
 * when it has been idle long enough (see masterOptions), and a run that comes
 * after one has ended must make a new login rather than wait on the old one.
 *
 * It never rejects and never fails a command: a machine that will not multiplex,
 * a socket that cannot be made, an ssh that is not there — each answers false,
 * and every command still reaches the machine on its own, exactly as it did
 * before there was a master.
 *
 * @param {Record<String, any>} connection
 * @param {{dataDir?: String}} [options] `dataDir` is where a connection's saved
 *   password is read from
 * @return {Promise<Boolean>} whether a master is up
 */
const ensureMaster = (connection, {dataDir = null} = {}) => {
  if (!connection || !connection.is_over_ssh) {
    return Promise.resolve(false)
  }

  const socket = controlPath(connection)

  if (!socket) {
    return Promise.resolve(false)
  }

  const known = masters.get(socket)

  // commands of one connection start together, and they are one login: the
  // second asks what the first is already asking
  if (known && known.opening) {
    return known.opening
  }

  const entry = known || {connection, owned: false}
  const opening = openMaster(connection, socket, entry, dataDir)

  entry.opening = opening
  masters.set(socket, entry)

  return opening
}

/**
 * Make the connection's login, or adopt one that is answering already.
 *
 * @param {Record<String, any>} connection
 * @param {String} socket
 * @param {Object} entry
 * @param {String|null} dataDir
 * @return {Promise<Boolean>}
 */
const openMaster = async (connection, socket, entry, dataDir) => {
  try {
    // a socket that answers is a login to travel down rather than to make
    // again, and it is not this process's to end (see closeMasters)
    if (await masterAnswers(connection)) {
      return true
    }

    const askpass = askpassEnvironment(dataDir, connection)

    // `-f` is what makes this a wait for a login rather than for the connection:
    // the master detaches once it is up and leaves the socket behind, and what
    // this spawn answers with is whether it got that far. `-N` is there because
    // there is nothing to run on the far side — being connected is the whole of it
    const child = spawn('ssh', ['-f', '-N', ...sshArgs(connection, {master: true})], {
      stdio: 'ignore',
      ...(askpass ? {env: Object.assign({}, process.env, askpass.env)} : {}),
    })

    const up = await new Promise(resolve => {
      child.on('error', () => resolve(false))
      child.on('close', code => resolve(code === 0))
    })

    // a login that did not happen is not remembered as one that did, so the
    // next command tries again
    if (!up) {
      if (masters.get(socket) === entry) {
        masters.delete(socket)
      }

      return false
    }

    entry.owned = true
    masters.set(socket, entry)

    return true
  } finally {
    entry.opening = null
  }
}

/**
 * End the logins this process made.
 *
 * A master ends by itself when it has been idle long enough (see masterOptions),
 * so this is the process leaving cleanly rather than a login it opened being
 * left on somebody's server. It is ended by signal rather than asked to leave:
 * ssh's own exit request ends a master between sessions, and one that was asked
 * while a session was still open keeps the connection and loses its socket,
 * which leaves nothing to ask a second time (seen outliving the app by minutes).
 * The socket a
 * login answers on is in its command line and in no other process's, so the
 * signal reaches exactly the logins this process started.
 */
const closeMasters = () => {
  for (const [socket, {owned}] of masters) {
    if (owned === false) {
      continue
    }

    try {
      const child = spawn('pkill', ['-TERM', '-f', `ControlPath=${socket}`], {stdio: 'ignore'})

      child.on('error', () => {})
    } catch (e) {
      // nothing to do about a pkill that will not even be started: the master
      // ends itself
    }
  }

  masters.clear()
}

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
 * @param {String} [options.dataDir] where the app's data is, which is where a
 *   connection's saved password is
 * @return {Promise<{stdout: String, stderr: String, code: Number|null}>}
 */
const exec = (connection, command, options = {}) => {
  if (!connection || !connection.is_over_ssh) {
    return run(connection, command, options)
  }

  // the login is not part of what a command is given to answer in: a command
  // that waits ten seconds for an answer waits ten seconds to be asked
  return ensureMaster(connection, {dataDir: options.dataDir}).then(() => run(connection, command, options))
}

const run = (connection, command, {timeout = defaultTimeout, maxBuffer, dataDir = null} = {}) => new Promise(resolve => {
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
    ? askpassEnvironment(dataDir, connection)
    : null

  // a local shell is made the leader of a process group of its own, so
  // stopping it stops what the command left running behind it. Windows has no
  // process group to signal, and a login over ssh is a client on this machine
  // whose server is somewhere else: those are stopped as the one child they
  // are.
  const overSsh = Boolean(connection && connection.is_over_ssh)
  const grouped = !overSsh && process.platform !== 'win32'

  const child = overSsh
    ? spawn('ssh', [...sshArgs(connection), remote], ...(askpass
      ? [{env: Object.assign({}, process.env, askpass.env)}]
      : []))
    : spawn('/bin/sh', ['-lc', command], grouped
      ? {cwd: connection && connection.path, detached: true}
      : {cwd: connection && connection.path})

  const cap = maxBuffer === undefined ? Infinity : maxBuffer

  let stdout = ''
  let stderr = ''
  let timer = null
  let done = false
  let cancelled = false
  let escalation = null

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

  const signalGroup = signal => {
    if (!grouped || !child.pid) {
      return false
    }

    try {
      // a negative id is the group the shell leads, never this process's own
      // group and never the one the app was started in
      process.kill(-child.pid, signal)

      return true
    } catch (e) {
      // the group is gone, or there was none to signal
      return false
    }
  }

  const signalChild = signal => {
    try {
      child.kill(signal)
    } catch (e) {
      // a child that is gone needs no more signals
    }
  }

  const groupAlive = () => {
    if (!grouped || !child.pid) {
      return false
    }

    try {
      process.kill(-child.pid, 0)

      return true
    } catch (e) {
      return false
    }
  }

  // stop the command and what it started. A TERM first, so a shell that was
  // about to write still writes; a command that ignores it is killed once the
  // grace is over, which is what keeps a trapped TERM from leaving a descendant
  // running. The signal reaches the group the shell leads, and only that.
  const cancel = () => {
    if (cancelled) {
      return
    }

    cancelled = true

    if (!signalGroup('SIGTERM')) {
      signalChild('SIGTERM')
    }

    escalation = setTimeout(() => {
      escalation = null

      // this only skips a group that is no longer there: it cannot tell a
      // process-group id that has been reused from the one cancelled here
      if (grouped && !groupAlive()) {
        return
      }

      if (!signalGroup('SIGKILL')) {
        signalChild('SIGKILL')
      }
    }, escalationTimeout)
  }

  // an answer nobody will read in full is not one to keep in memory in full
  const room = chunk => {
    if (stdout.length + stderr.length + chunk.length <= cap) {
      return true
    }

    cancel()
    finish(null)

    return false
  }

  child.stdout.on('data', chunk => {
    if (done) {
      return
    }

    if (room(chunk)) {
      stdout += chunk
    }
  })

  child.stderr.on('data', chunk => {
    if (done) {
      return
    }

    if (room(chunk)) {
      stderr += chunk
    }
  })

  child.on('error', error => {
    if (done) {
      return
    }

    // a machine that could not be reached at all is one with nothing to say
    stderr += String(error.message || error)
    finish(null)
  })

  // a normal end was never cancelled, so it has no group to escalate. A
  // cancelled one may still have a descendant that ignored the TERM, so its
  // timer stays until the group is empty; only then is it cleared
  child.on('close', code => {
    if (escalation && !groupAlive()) {
      clearTimeout(escalation)
      escalation = null
    }

    finish(code)
  })

  if (timeout > 0) {
    timer = setTimeout(() => {
      cancel()
      finish(null)
    }, timeout)
  }
})

module.exports = {
  defaultTimeout,
  quoted,
  exec,
  ensureMaster,
  closeMasters,
}
