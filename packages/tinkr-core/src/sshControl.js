const crypto = require('crypto')
const os = require('os')
const path = require('path')

/**
 * How a connection over ssh is kept open between the commands that use it.
 *
 * Logging in is the slowest thing about reaching another machine and it is paid
 * before anything happens there: on the connection this was measured against, a
 * handshake cost 0.7s against 0.2s once the connection was up — measured with
 * `ssh true`, three runs each way — and every run of a snippet is a fresh `ssh`,
 * so that half second was paid on every one of them. What ssh already does about
 * that is multiplexing: the first connection becomes a master, listens on a
 * socket, and the ones after it travel down that socket without logging in
 * again.
 *
 * That is what these options turn on, and it is a change to the transport rather
 * than to the session: a run still gets a php of its own (php never reloads a
 * class it has loaded, so a session kept between runs would answer with the code
 * the files held before they were edited). The `ControlPersist` is what keeps a
 * master alive for the next run when the master was one of the commands that
 * ends: a run's session is killed when the run is over, and the read of the
 * project that follows it leaves a master behind for the run after that.
 *
 * Nothing here may break a connection. ssh ignores a socket it cannot use and
 * connects on its own, so a machine that refuses multiplexing, a full disk, a
 * temporary directory with no room for a socket: each is a run that is as slow as
 * it was before rather than one that does not happen.
 *
 * Windows has no unix socket to listen on — its ssh uses a named pipe, and only
 * when it is told one — so a connection there is not multiplexed at all and is
 * reached exactly as it was.
 */

/**
 * How long a master waits for the next command before it ends itself, in
 * seconds.
 *
 * It has to outlast a person reading an answer and typing the next snippet, and
 * it is what keeps a master from sitting on a machine nobody is using.
 */
const persist = 300

/**
 * Longest control socket path ssh accepts.
 *
 * `sun_path` is 108 bytes on Linux and 104 on macOS, and a path over it is a
 * socket ssh cannot create: it says so and connects without one. The path is
 * short — one temporary directory plus a digest — and the check is for a
 * `TMPDIR` that is not short, in which case the socket goes in `/tmp`.
 */
const socketLimit = 100

/**
 * What a socket is named after: the machine and the account on it, which is what
 * an ssh connection is. A connection edited to another host is another socket,
 * and two connections to the same account share one master, which is the same
 * connection.
 *
 * @param {Object} connection
 * @return {String}
 */
const controlName = connection =>
  `${connection.ssh_user || ''}@${connection.ssh_server || ''}:${connection.ssh_port || 22}`

/**
 * The socket a connection's master listens on.
 *
 * It is derived rather than stored, so a session, a read of the project and a
 * one-off command find the same one without being told: a read is started where
 * a session comes up (see services/project), and neither is given the other's
 * address.
 *
 * The socket is named for this process as well as the connection, because a
 * socket is only worth sharing with a master this process started. A master
 * whose app was killed keeps its connection but is left without a socket file by
 * the next process that binds the same path, and a master with no socket can be
 * neither reused nor asked to end: naming the path after the process keeps one
 * process from taking a socket another is still listening on, and leaves a
 * master from a killed app to end itself when `persist` runs out.
 *
 * @param {Object} connection
 * @return {String|null} null where unix sockets are not a thing
 */
const controlPath = connection => {
  if (process.platform === 'win32') {
    return null
  }

  const name = `${controlName(connection)}:${process.pid}`
  const digest = crypto.createHash('sha1').update(name).digest('hex').slice(0, 16)
  const inTemp = path.join(os.tmpdir(), `tinkr-ssh-${digest}`)

  return inTemp.length <= socketLimit ? inTemp : path.join('/tmp', `tinkr-ssh-${digest}`)
}

/**
 * The options that make a command use a connection's master, and become one when
 * there is none.
 *
 * `auto` is what makes this safe to put on every command: a master that is there
 * is used, and one that is not is created by the command itself.
 *
 * @param {Object} connection
 * @return {Array<String>} the options, empty where multiplexing is not available
 */
const controlOptions = connection => {
  const socket = controlPath(connection)

  if (!socket) {
    return []
  }

  return [
    '-o', 'ControlMaster=auto',
    '-o', `ControlPath=${socket}`,
    '-o', `ControlPersist=${persist}`,
  ]
}

/**
 * The options that make a command the master itself.
 *
 * It is a master of its own rather than one of the commands that come and go,
 * because the app ends those: a run's session is killed when the run answers and
 * a master killed with it would take its socket with it, which is the next run
 * logging in again. The master the app starts (see tinkr-main's remote) is
 * nothing but a connection held open, so nothing that ends takes it with it.
 *
 * It also ends itself: a master is a login on somebody's server, and one that
 * outlived the app would be held open for nothing. Ten minutes without a command
 * down its socket is a connection nobody is using, and a link that has stopped
 * answering is one no command can travel down.
 *
 * @param {Object} connection
 * @return {Array<String>} the options, empty where multiplexing is not available
 */
const masterOptions = connection => {
  const socket = controlPath(connection)

  if (!socket) {
    return []
  }

  return [
    '-o', 'ControlMaster=yes',
    '-o', `ControlPath=${socket}`,
    '-o', 'ControlPersist=600',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    // a machine with no route to it is one a login can wait on for minutes, and
    // every command that reaches this connection waits on the login: a machine
    // that cannot be logged in to in fifteen seconds is one to reach without it
    '-o', 'ConnectTimeout=15',
  ]
}

module.exports = {
  controlName,
  controlPath,
  controlOptions,
  masterOptions,
  persist,
}
