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
 * The keys a kill sends before it gives up on the session, and how long each is
 * given before the next.
 *
 * A kill only signals the pty's shell, and the php doing the work is not that
 * shell: it is a `lerd php` or `podman exec` or `docker exec` or `ssh` away, in
 * another process tree. A run still going when the session is killed — a
 * timeout, a run that was replaced, a window closing — kept going in that other
 * tree: an infinite loop burned a core for as long as the container lived, and a
 * guarded `sleep(60)` held its transaction open and committed it later, unseen.
 *
 * The terminal is what reaches it. `\u0003` is ETX, which the terminal's line
 * discipline turns into SIGINT for the process in the foreground — the php — and
 * psysh forwards it to the forked child actually evaluating the snippet. It is
 * sent twice: the first one lands while the loop still owns the terminal often
 * enough that one is not enough, and the two are spaced far enough apart that
 * psysh is back at its prompt for the second. `exit();` then leaves a session
 * that is at its prompt, and the signal ends the shell either way.
 *
 * @type {Array<{keys: String, wait: Number}>}
 */
const killSteps = [
  {keys: '\u0003', wait: 400},
  {keys: '\u0003', wait: 400},
  {keys: 'exit();\r', wait: 150},
]

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
 * What the shell prints once the command it was given has exited: an OSC 9999
 * carrying the exit status, which no terminal draws and which no command of a
 * project prints.
 *
 * A shell's prompt and a command's prompt both take the terminal with the same
 * escape (see Session#ready), so a command that failed to boot is
 * indistinguishable from one that is reading — until its status comes back. The
 * status is the only thing the shell knows and the command does not, and it
 * arrives with the exit, well before any timeout is spent.
 *
 * `printf` is the shell's own, and `\033` and `\007` are written as octal
 * because a shell's `printf` is not php's.
 */
const bootMarker = '\u001b]9999;'
const bootSentinel = String.raw`;printf '\033]9999;%s\007' $?`

/**
 * How much of what the command printed is kept for the failure it explains.
 *
 * The text is what a developer would read at a terminal, and it is the answer a
 * session that never booted gives instead of a message about a timeout.
 */
const bootOutputLimit = 4000

/**
 * The error a session raises when the command it was started with exited
 * instead of becoming the session.
 *
 * It is the class the MCP server answers with when a run's session never came
 * up (see tinkr-mcp's sessionFailure), so the terminal's own words reach the
 * caller rather than a message about a timeout.
 */
class SessionError extends Error {
  /**
   * @param {String} message
   * @param {{output?: String, status?: Number|null}} [detail] what the command
   * printed, and the status the shell reported for it
   */
  constructor(message, {output = '', status = null} = {}) {
    super(message)

    this.name = 'SessionError'
    this.output = output
    this.status = status
  }
}

/**
 * What a session that never booted says about itself, in the terms a developer
 * reading a terminal would use.
 *
 * The whole of what the command printed is carried, not only its last line: a
 * platform check prints several, and the one that explains the failure is not
 * always the last.
 *
 * @param {String} output what the command printed
 * @param {Number|null} status the status the shell reported, or null
 * @return {String}
 */
const sessionFailureMessage = (output, status) => {
  const code = status === null ? '' : ` (exit status ${status})`

  if (!output) {
    return `the session's command exited before it was ready${code}`
  }

  return `the session's command exited before it was ready${code}: ${output}`
}

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
      // the command travels inside the ssh line rather than being typed after
      // it: ssh's own prompts — a host key to accept, a password to type — read
      // the terminal it was started on, and a command written there alongside
      // ssh is what they answered instead. See parseSSHCommand.
      this.pty.write(`${parseSSHCommand(this.connection, command)}${bootSentinel}\r`)
    } else if (command) {
      // the status of the command, printed by the shell once it is back: the
      // shell's prompt is the same escape as a command's, so this is what says
      // which of the two the session is looking at (see Session#ready)
      this.pty.write(`${withoutPager(command)}${bootSentinel}\r`)
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
   * A command that fails to boot is the other way the terminal comes back: the
   * shell takes it over again and prints its own prompt, which is the same
   * escape a command's prompt is (see `bootMarker`). That is why the command's
   * line carries a status sentinel: the shell prints it when the command exits,
   * before it prints a prompt, so its arrival is what says the command never
   * became the session. The answer is then the failure itself — what the
   * command printed and the status it left — rather than a timeout later.
   *
   * @return {Promise<void>} rejects with a SessionError when the command exits
   * before it takes the terminal
   */
  ready() {
    return new Promise((resolve, reject) => {
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
      let booted = ''

      const settle = () => {
        clearTimeout(quiet)
        clearTimeout(limit)
        listener.dispose()
        resolve()
      }

      const fail = status => {
        clearTimeout(quiet)
        clearTimeout(limit)
        listener.dispose()

        const output = stripSessionNotes(booted).replace(/\r\n/g, '\n').trim()

        reject(new SessionError(sessionFailureMessage(output, status), {output, status}))
      }

      listener = pty.onData(data => {
        // the shell printed the status of the command it was given, so the
        // command has exited and the terminal is the shell's again
        const sentinel = data.lastIndexOf(bootMarker)

        if (sentinel !== -1) {
          // the shell's printf writes the status right after the marker, and
          // nothing but digits comes before its terminator
          const rest = data.slice(sentinel + bootMarker.length)
          const end = rest.search(/\D/)
          const digits = end === -1 ? rest : rest.slice(0, end)
          // what the command printed follows the handover and precedes the
          // status, and it is the whole of the answer when there is none
          booted += data.slice(0, sentinel)

          fail(digits === '' ? null : Number(digits))

          return
        }

        const taken = data.lastIndexOf(terminalTaken)
        const given = data.lastIndexOf(terminalGivenUp)

        if (given !== -1 || taken !== -1) {
          everSeen = true
        }

        // what the command prints is what explains a boot that failed, so it is
        // kept from the handover — before that the terminal is the shell's
        if (handedBack) {
          booted += data

          if (booted.length > bootOutputLimit * 4) {
            booted = booted.slice(-bootOutputLimit)
          }
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
   * End the session, and stop what it is running.
   *
   * A kill only signals the shell, and the php doing the work is not that shell
   * when the command runs through docker, podman or ssh: it keeps running inside
   * the container, on a run whose answer nobody is waiting for any more. So the
   * interrupt goes in first — see `killSteps` — and the signal is what ends the
   * session either way.
   *
   * The writes are asynchronous, so each one is given its moment before the next:
   * the interrupt has to reach php while it is still the foreground process, and
   * `exit();` is readline input that only means anything once the interrupt has
   * put psysh back at its prompt.
   */
  kill() {
    const pty = this.pty

    if (!pty) {
      return
    }

    this.pty = null

    // the interrupt has to reach php while it is still the foreground process,
    // and `exit();` only means anything once the interrupt has put psysh back at
    // its prompt — so the keys are sent on a timer long enough for each to be
    // taken, and the signal comes last, whether or not they were
    let wait = 0
    const keys = []

    for (const step of killSteps) {
      keys.push(step.keys)
      wait += step.wait
    }

    keys.forEach((chars, index) => {
      let at = 0

      for (let before = 0; before < index; before++) {
        at += killSteps[before].wait
      }

      setTimeout(() => {
        try {
          pty.write(chars)
        } catch (e) {
          // a session that has already gone is what a kill is for
        }
      }, at)
    })

    setTimeout(() => {
      try {
        pty.kill()
      } catch (e) {
      }
    }, wait)
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
  const {timeout = 30000, guard = null} = options
  // what the session starts with: what the caller asked for, and otherwise what
  // the connection was saved with. A run with neither would be written into a
  // bare shell, which answers nothing and ends in a timeout that says nothing
  // about why
  const command = options.command || connection.command || null
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
    }).catch(error => finish(error))

    session.onExit(() => {
      finish(new Error('the session exited before it answered'))
    })
  })
}

module.exports = {
  Session,
  SessionError,
  runCode,
  runOutput,
  withoutPager,
  killSteps,
  bootSentinel,
}
