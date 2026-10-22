const {passwordArgs} = require('./sshAskpass')
const {inContainer} = require('./containerCommand')
const {controlOptions, masterOptions} = require('./sshControl')

/**
 * A value as one word of the shell the session is typed into.
 *
 * The connection's fields are what a person typed, and they are typed into a
 * shell line: a path with a space in it splits into two, a quote leaves the
 * shell waiting for the end of a string, and a `;` is a statement of its own —
 * `127.0.0.1; touch /tmp/x` ran the touch. So each is quoted as the one word it
 * is.
 *
 * @param {String} value
 * @return {String}
 */
const word = value => `'${String(value).replace(/'/g, "'\\''")}'`

/**
 * Whether a connection's fields are ones ssh can be given at all.
 *
 * A user or a host that starts with `-` is read as an option — `-oProxyCommand=`
 * runs a command — and a host with whitespace or a slash is not a host. None of
 * that is a value to escape: it is one to refuse, so the refusal can say why
 * rather than the session failing somewhere nobody can see.
 *
 * @param {Object} connection
 * @return {String|null} what is wrong with it, or null when nothing is
 */
const sshProblem = connection => {
  const user = String(connection.ssh_user || '')
  const server = String(connection.ssh_server || '')
  const port = String(connection.ssh_port || '')

  if (!user || !server) {
    return 'an ssh connection needs a user and a server'
  }

  if (user.startsWith('-') || server.startsWith('-')) {
    return 'the ssh user and server cannot start with "-"'
  }

  if (/[\s/@]/.test(user) || /[\s/]/.test(server)) {
    return 'the ssh user and server cannot hold spaces or slashes'
  }

  if (port && !/^\d+$/.test(port)) {
    return 'the ssh port has to be a number'
  }

  return null
}

/**
 * Which machine and account a command reaches, and how it logs in to them.
 *
 * @param {Object} connection
 * @returns {Array<String>}
 */
const targetArgs = connection => {
  const args = []

  if (connection.ssh_port) {
    args.push('-p', String(connection.ssh_port))
  }

  if (connection.ssh_key) {
    args.push('-i', String(connection.ssh_key))
  }

  // a connection with a saved password is answered by the app's own helper, so
  // the two options that make one usable — a host key accepted on first use,
  // and one prompt — travel with it (see sshAskpass)
  args.push(...passwordArgs(connection))

  args.push('--', `${connection.ssh_user}@${connection.ssh_server}`)

  return args
}

/**
 * How a connection is reached over ssh, as the arguments of the command that
 * reaches it.
 *
 * The port and the key are only in the list when the connection has them, and
 * the last one is always the target — `root@192.168.1.1`. Both the session that
 * logs in and the one-off commands a connection is asked to run travel this way,
 * so the two cannot drift: whatever reaches the machine reaches it the same.
 * What is in front of them is the multiplexing that keeps the login from being
 * paid twice (see sshControl).
 *
 * These are arguments of a command that is run without a shell — `spawn('ssh',
 * args)` — so a value here is one word already: nothing splits it and nothing
 * runs it. `--` before the target is what makes an argument that looks like an
 * option stop being read as one.
 *
 * @param {Object} connection
 * @param {Object} [options]
 * @param {Boolean} [options.master] whether the command is the connection's
 *   master rather than one that travels down its socket
 * @returns {Array<String>}
 */
const sshArgs = (connection, {master = false} = {}) => [
  ...(master ? masterOptions(connection) : controlOptions(connection)),
  ...targetArgs(connection),
]

/**
 * The line a session types into its own shell to reach the connection.
 *
 * This one is a shell line — the session has a shell in front of it, and what is
 * written into a pty is read by that shell — so every part of it is quoted as
 * the word it is: the key, the port, the target, and the command that cd's into
 * the project and starts a login shell.
 *
 * Two things about the line are load-bearing:
 *
 * - **Every option comes before the target.** ssh reads the first argument after
 *   the destination as the command to run there, so a `-t` written after it is
 *   not an option at all: it becomes part of the remote command line, the far
 *   shell tries to run a program called `-t`, and the session that comes back
 *   has no terminal. That is a login that "does not initialize": the shell is
 *   there but not as the pty a tinker needs.
 * - **The session is a passenger, not the driver.** The socket options come
 *   before the target along with everything else, so a session that starts
 *   while the connection is already open travels down it instead of logging in
 *   again (see sshControl). It is what a run of a snippet costs once the
 *   connection is up.
 * - **The remote side is given a terminal and an interactive shell.** ssh only
 *   allocates a pty when told to (`-t`), and a login shell on the far side is
 *   interactive only when it has one. psysh needs both: without a terminal it
 *   reads its input as a pipe and never draws a prompt.
 *
 * `exec` is what the shell is started with, so the tty's signals reach bash and
 * the tinker under it rather than an extra shell in between, and `&&` is what
 * makes a directory that is not there a failure that says so instead of a
 * session that quietly lands in the home directory.
 *
 * The command the session is started with travels in this line too, rather than
 * being typed after ssh has been started. ssh's own questions — a host key it
 * has not seen, a password to type — are read from the terminal ssh was started
 * on, and a command written into that terminal alongside ssh is what they answer
 * instead: on a first connection the command was consumed by
 * `Are you sure you want to continue connecting?`, and the session it was for
 * never began. Written here, it is the remote shell's to run, and ssh's
 * questions are ssh's alone.
 *
 * A connection with a saved password puts the helper's variables at the front of
 * this line rather than in the pty's environment, and that placement is the
 * whole of it working: the shell in front of ssh is a *login* shell, and a
 * profile that sets `SSH_ASKPASS` — a desktop's own askpass helper is one — runs
 * after the environment was handed over and replaces what was in it. What is
 * written on the line is read after the profile has run, so it is what ssh sees.
 * A pty's environment is the first half of the answer; this is the half that
 * survives the profile.
 *
 * @param {Object} connection
 * @param {String} [command] what to run once the remote shell is up
 * @param {Object} [askpass] what the helper needs to find the password, when the
 *   connection has one (see sshAskpass); empty for a connection without one
 * @returns {String}
 */
const parseSSHCommand = (connection, command = null, askpass = null) => {
  const problem = sshProblem(connection)

  if (problem) {
    return `echo ${word(`Tinkr: ${problem}`)}`
  }

  const args = ['ssh', '-t']

  // the multiplexing options first, then the ones that name the machine and how
  // it is logged in to; both lists are the same ones the spawned commands use
  ;[...controlOptions(connection), ...targetArgs(connection)]
    .forEach(option => args.push(word(option)))

  // what the remote side runs: into the project's directory, then whatever the
  // session was started with, and otherwise the account's own login shell
  const remote = []

  // a project in a container is not in the machine's directory. `path` is where
  // the machine keeps it, and a containerized deploy need not keep it there at
  // all — the files can be in a volume, or only in the image. The command is a
  // `docker exec` that cd's inside the container itself (see containerRead), so
  // a `cd` out here is a directory that need not exist, and the session would
  // fail before the container was ever reached
  if (connection.path && !inContainer(connection)) {
    remote.push(`cd ${word(connection.path)}`)
  }

  if (command) {
    // the project's directory, and then the command, which only runs when the
    // directory was reached: a path that is not there is a failure that says so
    args.push(word(remote.length ? `${remote[0]} && ${command}` : command))
  } else {
    // no command: a login shell, as ssh would have run it, in the project's
    // directory when one was named
    args.push(word(remote.length ? `${remote[0]} && exec bash --login -i` : 'exec bash --login -i'))
  }

  // the helper's variables go before the command, as assignments the shell reads
  // after its profile has run: `SSH_ASKPASS=… ssh -t …`
  const assignments = Object.entries(askpass || {})
    .map(([name, value]) => `${name}=${word(value)}`)

  return assignments.length ? `${assignments.join(' ')} ${args.join(' ')}` : args.join(' ')
}

module.exports = {
  sshArgs,
  parseSSHCommand,
  sshProblem,
}
