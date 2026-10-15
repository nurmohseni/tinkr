const pty = require('node-pty')
const defaultShell = require('default-shell')
const osLocale = require('os-locale')
const log = require('electron-log')
const os = require('os')
const fs = require('fs')

const {version} = require('../../package.json')
const {config} = require('../database/config')
const {appName} = require('../constants')
const {parseSSHCommand} = require('../utils/parseSSHCommand')

/**
 * Time the quit request gets to reach the session before its shell is killed.
 * See Pty#kill.
 */
const killDelay = 100

/**
 * The command to start the session with, with the pager out of the way.
 *
 * psysh hands output taller than the terminal to a pager, and the pager it picks
 * by default is `/usr/bin/less -R -F -X`: `less` takes the pty and waits for a
 * key. Everything the session goes on to print — including the value a run is
 * wrapped in — then sits behind it, so `dump($bigArray)` never comes back and
 * the run shows no value at all.
 *
 * psysh takes the pager from `cli.pager` before it looks for `less`, and it does
 * not read `PAGER` (that is the variable everyone reaches for first, and it is
 * read by nothing here). `cat` is what its own configuration maps to "no pager",
 * and a `cat` between the session and the terminal writes the same bytes, so a
 * normal print looks exactly as it did and keeps its colour.
 *
 * Only the `php ...` shape can carry an ini setting, and that is the command the
 * app ships as its default; a command someone wrote differently is left alone
 * rather than rewritten into something they did not ask for.
 *
 * @param {String} command the connection's command, or the configured default
 * @return {String}
 */
const withoutPager = command => command.replace(/^(\s*)php(\s)/, '$1php -d cli.pager=cat$2')

class Pty {
  constructor(connection) {
    this.connection = connection
    this.pty = null
  }

  /**
   * 初始化 connection pty 进程
   *
   * @param {String} [command] what to run once the shell is up, or the
   * connection's own command when there is nothing else to run
   */
  connect(command = null) {
    const shell = defaultShell
    // A login shell is a posix shell's idea. cmd.exe reads --login as a program
    // to run, fails, and leaves a session that does nothing else: no prompt, no
    // command, no php. Windows gets no arguments.
    const args = process.platform === 'win32' ? [] : ['--login']

    const env = Object.assign(
      {},
      process.env,
      {
        LANG: `${osLocale.sync().replace(/-/, '_')}.UTF-8`,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: appName,
        TERM_PROGRAM_VERSION: version,
      },
    )

    const options = {
      // a session starts in the home directory. Windows has no HOME in its
      // environment to read it from, so the session was spawned there with no
      // working directory at all: os.homedir() answers on every platform.
      cwd: env.HOME || os.homedir(),
      env,
      encoding: 'utf-8',
      // node-pty's conpty backend deadlocks inside spawn on windows: the call
      // never returns, so the window that made it never gets another line of
      // its boot done. winpty is the backend that answers.
      useConpty: false,
    }

    if (!this.connection.is_over_ssh) {
      try {
        fs.accessSync(this.connection.path)
        options.cwd = this.connection.path
      } catch (e) {
      }
    }

    log.info('[pty] starting', shell, JSON.stringify(args))

    try {
      this.pty = pty.spawn(shell, args, options)

      log.info('[pty] started')
    } catch (e) {
      // a session that will not start is a connection that cannot be used, and
      // the shell and the directory it was started in say which one went wrong
      log.error('[pty] could not start', shell, 'in', options.cwd, '-', e.message)

      this.pty = null

      return
    }

    if (this.connection.is_over_ssh) {
      // TODO 如果是 ssh，需要去检查 ssh 的连接是否断开。
      this.pty.write(`${parseSSHCommand(this.connection)}\r`)
    }

    // 默认使用配置中的 default command
    const line = command || this.connection.command || config.get('command_default')

    if (line) {
      this.pty.write(`${withoutPager(line)}\r`)
    }
  }

  /**
   * 重连
   */
  reconnect() {
    this.kill()
    this.connect()
  }

  onData(cb) {
    return this.pty.onData(cb)
  }

  /**
   * @param {Function} cb
   */
  onExit(cb) {
    this.pty.onExit(cb)
  }

  /**
   * 清理
   */
  kill() {
    const pty = this.pty

    if (!pty) {
      return
    }

    this.pty = null

    // A kill only signals the shell, and the session's own process outlives it
    // when the command runs through docker or ssh (`php artisan tinker` keeps
    // running inside the container). Ask the session to quit as well: `exit()`
    // is php, so a plain shell in the foreground only reports a syntax error.
    // The write is asynchronous, so the kill waits for it to land.
    pty.write('exit();\r')
    setTimeout(() => pty.kill(), killDelay)
  }

  /**
   * terminal 输入
   *
   * @param {String} code
   */
  input(code) {
    this.pty.write(code)
  }
}

module.exports = {
  Pty,
  withoutPager,
}
