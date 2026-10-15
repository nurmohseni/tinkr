const log = require('electron-log')

const {Session} = require('tinkr-core')

const {version} = require('../../package.json')
const {config} = require('../database/config')
const {appName} = require('../constants')

/**
 * The session a connection's window runs its code in.
 *
 * What a session is — the shell, its arguments, the environment, the working
 * directory, the pager, the kill — lives in tinkr-core, where the MCP server
 * boots its own through the same code. That is the difference between the two
 * halves: this one is the app's, so a session it starts reports the app in
 * `TERM_PROGRAM`, runs the app's configured command, and complains to the app's
 * log rather than to a terminal's stderr.
 */
class Pty {
  constructor(connection) {
    this.connection = connection
    this.session = null
  }

  /**
   * Boot the session.
   *
   * @param {String} [command] what to run once the shell is up, or the
   * connection's own command when there is nothing else to run
   */
  connect(command = null) {
    this.session = new Session(this.connection, {
      appName,
      appVersion: version,
      log,
    })

    // 默认使用配置中的 default command
    this.session.start(command || this.connection.command || config.get('command_default'))
  }

  /**
   * 重连
   */
  reconnect() {
    this.kill()
    this.connect()
  }

  onData(cb) {
    return this.session.onData(cb)
  }

  /**
   * @param {Function} cb
   */
  onExit(cb) {
    this.session.onExit(cb)
  }

  /**
   * 清理
   */
  kill() {
    if (!this.session) {
      return
    }

    this.session.kill()
  }

  /**
   * terminal 输入
   *
   * @param {String} code
   */
  input(code) {
    this.session.write(code)
  }
}

module.exports = {
  Pty,
}
