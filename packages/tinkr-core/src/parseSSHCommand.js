/**
 * How a connection is reached over ssh, as the arguments of the command that
 * reaches it.
 *
 * The port and the key are only in the list when the connection has them, and
 * the last one is always the target — `root@192.168.1.1`. Both the session that
 * logs in and the one-off commands a connection is asked to run travel this way,
 * so the two cannot drift: whatever reaches the machine reaches it the same.
 *
 * @param {Object} connection
 * @returns {Array<String>}
 */
const sshArgs = connection => {
  const args = []

  if (connection.ssh_port) {
    args.push(`-p${connection.ssh_port}`)
  }

  if (connection.ssh_key) {
    args.push(`-i${connection.ssh_key}`)
  }

  args.push(`${connection.ssh_user}@${connection.ssh_server}`)

  return args
}

/**
 * parse ssh command string via connection
 *
 * @param {Object} connection
 * @returns {string}
 */
const parseSSHCommand = connection => {
  const args = [
    'ssh',
    ...sshArgs(connection),
  ]

  if (connection.path) {
    args.push(`-t 'cd ${connection.path};bash --login'`)
  }

  return args.join(' ')
}

module.exports = {
  sshArgs,
  parseSSHCommand,
}
