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
 * How a connection is reached over ssh, as the arguments of the command that
 * reaches it.
 *
 * The port and the key are only in the list when the connection has them, and
 * the last one is always the target — `root@192.168.1.1`. Both the session that
 * logs in and the one-off commands a connection is asked to run travel this way,
 * so the two cannot drift: whatever reaches the machine reaches it the same.
 *
 * These are arguments of a command that is run without a shell — `spawn('ssh',
 * args)` — so a value here is one word already: nothing splits it and nothing
 * runs it. `--` before the target is what makes an argument that looks like an
 * option stop being read as one.
 *
 * @param {Object} connection
 * @returns {Array<String>}
 */
const sshArgs = connection => {
  const args = []

  if (connection.ssh_port) {
    args.push('-p', String(connection.ssh_port))
  }

  if (connection.ssh_key) {
    args.push('-i', String(connection.ssh_key))
  }

  args.push('--', `${connection.ssh_user}@${connection.ssh_server}`)

  return args
}

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
 * @param {Object} connection
 * @param {String} [command] what to run once the remote shell is up
 * @returns {String}
 */
const parseSSHCommand = (connection, command = null) => {
  const problem = sshProblem(connection)

  if (problem) {
    return `echo ${word(`Tinkr: ${problem}`)}`
  }

  const args = ['ssh', '-t']

  if (connection.ssh_port) {
    args.push('-p', word(connection.ssh_port))
  }

  if (connection.ssh_key) {
    args.push('-i', word(connection.ssh_key))
  }

  args.push('--', word(`${connection.ssh_user}@${connection.ssh_server}`))

  // what the remote side runs: into the project's directory, then whatever the
  // session was started with, and otherwise the account's own login shell
  const remote = []

  if (connection.path) {
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

  return args.join(' ')
}

module.exports = {
  sshArgs,
  parseSSHCommand,
  sshProblem,
}
