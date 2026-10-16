const pty = require('node-pty')
const defaultShell = require('default-shell')
const osLocale = require('os-locale')
const os = require('os')
const fs = require('fs')

const {wrapRun, RunResultFilter} = require('./runResult')
const {stripSessionNotes} = require('./terminalOutput')
const {importsFor} = require('./classIndex')
const {parseSSHCommand} = require('./parseSSHCommand')

/**
 * Time the quit request gets to reach the session before its shell is killed.
 * See Session#kill.
 */
const killDelay = 100

/**
 * How long a session is given to answer the command it was started with before
 * the run is written into it anyway, and how still the command has to be after
 * the shell handed it the terminal to count as the command being up. See
 * Session#ready.
 */
const readyQuiet = 1500
const readyLimit = 5000

/**
 * The two escapes readline prints when it takes the terminal over and when it
 * hands it back: bracket paste on, and bracket paste off. See Session#ready.
 */
const terminalTaken = '\u001b[?2004h'
const terminalGivenUp = '\u001b[?2004l'

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

/**
 * A session: the shell, the tinker running in it, and the pty between them.
 *
 * Both the app's window and the MCP server run code through this, so a session
 * behaves the same whoever asked for it — the same shell arguments, the same
 * environment, the same working directory, the same pager, the same kill. What
 * differs is only what is done with the stream.
 */
class Session {
  /**
   * @param {Record<String, any>} connection
   * @param {{appName?: String, appVersion?: String, log?: Object}} [options]
   *   what the session reports itself as (`TERM_PROGRAM`), and where a session
   *   that will not start is reported. No window and no electron is involved.
   */
  constructor(connection, {appName = 'Tinkr', appVersion = '', log = console} = {}) {
    this.connection = connection
    this.appName = appName
    this.appVersion = appVersion
    this.log = log
    this.pty = null
  }

  /**
   * Start the shell, and write `command` into it once it is up.
   *
   * The connection's own command is what a session is started with in the app;
   * here it is handed in, because what a session runs by default is a
   * preference the app keeps.
   *
   * @param {String} [command]
   */
  start(command = null) {
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
        TERM_PROGRAM: this.appName,
        TERM_PROGRAM_VERSION: this.appVersion,
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

    try {
      this.pty = pty.spawn(shell, args, options)
    } catch (e) {
      // a session that will not start is a connection that cannot be used, and
      // the shell and the directory it was started in say which one went wrong
      this.log.error('[session] could not start', shell, 'in', options.cwd, '-', e.message)

      this.pty = null

      return
    }

    if (this.connection.is_over_ssh) {
      this.pty.write(`${parseSSHCommand(this.connection)}\r`)
    }

    if (command) {
      this.pty.write(`${withoutPager(command)}\r`)
    }
  }

  /**
   * @param {Function} cb
   * @return {Object} what the pty is listened to through, so it can be dropped
   */
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
   * Answer once the session's command is reading the terminal, so a run written
   * into it arrives whole.
   *
   * The pty hands over whatever it is given, but the shell reads its own command
   * line first, and while the command it started is booting the terminal is back
   * in its canonical mode. The canonical input queue holds 4096 bytes and drops
   * what does not fit in it: a run written straight after the command — the
   * wrapper alone is nearly 4 KB, and a guarded run is past it — reaches the
   * session cut in the middle of a statement. psysh then reads the rest of the
   * line as a statement that is not finished, waits for the part that was
   * dropped, and answers nothing at all.
   *
   * Readline is what shows the terminal changing hands: a shell hands it back
   * (`?2004l`) before it runs the command, and the command takes it (`?2004h`)
   * along with the prompt it prints next. A session is written into once the
   * command has taken it, and once the handback has been followed by nothing at
   * all for a moment — a command that does not use readline takes the terminal
   * without saying so, and by then it is up either way. A session whose shell
   * never hands the terminal back is written into at the limit instead of being
   * left idle: a shell that is still reading its own files is quiet too, so
   * silence on its own says nothing about whether the command is ready.
   *
   * @return {Promise<void>}
   */
  ready() {
    return new Promise(resolve => {
      const pty = this.pty

      if (!pty) {
        resolve()

        return
      }

      let quiet = null
      let limit = null
      let listener = null
      let handedBack = false
      let everSeen = false

      const settle = () => {
        clearTimeout(quiet)
        clearTimeout(limit)
        listener.dispose()
        resolve()
      }

      listener = pty.onData(data => {
        const taken = data.lastIndexOf(terminalTaken)
        const given = data.lastIndexOf(terminalGivenUp)

        if (given !== -1 || taken !== -1) {
          everSeen = true
        }

        // the command is reading: whichever of the two escapes is last is the
        // state the terminal is in
        if (given !== -1 && taken > given) {
          settle()

          return
        }

        if (given !== -1) {
          handedBack = true
          clearTimeout(quiet)
          quiet = setTimeout(settle, readyQuiet)

          return
        }

        if (handedBack && taken !== -1) {
          settle()

          return
        }

        // a shell that never says either escape — no readline, a session over ssh
        // — is not saying that the command is reading either, so it is written
        // into on a longer moment of quiet than reading its own files takes
        if (!everSeen) {
          clearTimeout(quiet)
          quiet = setTimeout(settle, readyQuiet)

          return
        }

        // the shell has said it is reading and has not handed the terminal over:
        // a run written into it now is what the line limit cuts, so nothing
        // settles this but the handover itself, or the limit below
        clearTimeout(quiet)
      })

      limit = setTimeout(settle, readyLimit)
    })
  }

  /**
   * @param {String} code
   */
  write(code) {
    this.pty.write(code)
  }

  /**
   * End the session.
   *
   * A kill only signals the shell, and the session's own process outlives it
   * when the command runs through docker or ssh (`php artisan tinker` keeps
   * running inside the container). Ask the session to quit as well: `exit()`
   * is php, so a plain shell in the foreground only reports a syntax error.
   * The write is asynchronous, so the kill waits for it to land.
   */
  kill() {
    const pty = this.pty

    if (!pty) {
      return
    }

    this.pty = null

    pty.write('exit();\r')
    setTimeout(() => pty.kill(), killDelay)
  }
}

/**
 * What the run printed, out of what the session wrote, as text.
 *
 * @param {RunResultFilter} filter
 * @return {String}
 */
const runOutput = filter => stripSessionNotes(filter.printed).replace(/\r\n/g, '\n').trim()

/**
 * Run a snippet in the connection's own session, and answer with what it
 * returned.
 *
 * Every call gets a session of its own, and the session is killed once it has
 * answered: php never reloads a class it has already loaded, so a session kept
 * between calls would serve whatever those classes were before the file on disk
 * changed. That is the app's rule for Run as well.
 *
 * The snippet is wrapped so the session prints its value between two markers
 * (see runResult.wrapRun), and the marker is new for every run, so an answer
 * that arrives late can never be read as this run's.
 *
 * @param {Record<String, any>} connection
 * @param {String} code
 * @param {{timeout?: Number, command?: String, guard?: String, appName?: String,
 *   appVersion?: String, log?: Object}} [options] `command` is what the session
 *   is started with when the connection names none, and `guard` is what the run
 *   is guarded with: `rollback` for a dry run, `commit` for the same run kept
 * @return {Promise<{value: any, blocks: Array, error: Object|null,
 *   queries: Array, queriesTotal: Number, imported?: Object,
 *   transaction?: Object, output: String}>}
 *   `queries` is what the run sent to its connections (see runResult.QUERY_BLOCK),
 *   and `queriesTotal` counts every query the run sent, stored or not.
 *   `transaction` is what a guarded run did with the transaction it was sent
 *   under (see runResult.guardArm), and a run without a guard is not sent one
 */
const runCode = (connection, code, options = {}) => {
  const {timeout = 30000, command = null, guard = null} = options
  const session = new Session(connection, options)
  // a session over ssh runs in the remote project, whose composer files are not
  // on this machine to read
  const imports = !connection.is_over_ssh && connection.path
    ? importsFor(connection.path, code)
    : {}
  const run = wrapRun(code, imports, guard)
  const filter = new RunResultFilter(run.marker, run.start)

  return new Promise((resolve, reject) => {
    let settled = false

    /**
     * @param {Error|null} error
     * @param {Object} [result]
     */
    const finish = (error, result) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      session.kill()

      if (error) {
        reject(error)

        return
      }

      resolve(result)
    }

    const timer = setTimeout(
      () => finish(new Error(`the session did not answer within ${timeout}ms`)),
      timeout,
    )

    session.start(command)

    if (!session.pty) {
      finish(new Error(`the session could not be started in ${connection.path || os.homedir()}`))

      return
    }

    session.onData(data => {
      const {result} = filter.push(data)

      if (result) {
        finish(null, Object.assign({}, result, {output: runOutput(filter)}))
      }
    })

    // the run goes in once the command is reading the terminal: handed over
    // before that, anything past the terminal's own buffer is dropped and the
    // run is parsed in half. See Session#ready
    session.ready().then(() => {
      if (settled || !session.pty) {
        return
      }

      session.write(`${run.code}\r`)
    })

    session.onExit(() => {
      finish(new Error('the session exited before it answered'))
    })
  })
}

module.exports = {
  Session,
  runCode,
  runOutput,
  withoutPager,
  killDelay,
}
