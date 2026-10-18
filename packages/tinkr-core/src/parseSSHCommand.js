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
 * @param {Object} connection
 * @returns {String}
 */
const parseSSHCommand = connection => {
  const problem = sshProblem(connection)

  if (problem) {
    return `echo ${word(`Tinkr: ${problem}`)}`
  }

  const args = ['ssh']

  if (connection.ssh_port) {
    args.push('-p', word(connection.ssh_port))
  }

  if (connection.ssh_key) {
    args.push('-i', word(connection.ssh_key))
  }

  args.push('--', word(`${connection.ssh_user}@${connection.ssh_server}`))

  if (connection.path) {
    args.push('-t', word(`cd ${word(connection.path)};bash --login`))
  }

  return args.join(' ')
}

module.exports = {
  sshArgs,
  parseSSHCommand,
  sshProblem,
}
