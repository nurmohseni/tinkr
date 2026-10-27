const pty = require('node-pty')
const defaultShell = require('default-shell')
const osLocale = require('os-locale')
const os = require('os')
const fs = require('fs')

const {wrapRun, typedRun, RunResultFilter} = require('./runResult')
const {stripRendering, stripSessionNotes} = require('./terminalOutput')
const {importsFor} = require('./classIndex')
const {parseSSHCommand} = require('./parseSSHCommand')
const {askpassEnvironment} = require('./sshAskpass')
const {sessionCommand} = require('./containerCommand')
const {isCloud, runCloud, cloudTokenOf} = require('./cloud')

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
 * discipline turns into SIGINT for the process in the foreground — the php. A
 * run takes that signal as the end of the process for as long as it evaluates
 * (see runResult.INTERRUPT_ARM), so a run blocked inside a query ends as well:
 * caught, the signal waited for the query, and the run outlived its kill with
 * its locks held. It is sent twice: the first one lands while the loop still
 * owns the terminal often enough that one is not enough, and the two are spaced
 * far enough apart that psysh is back at its prompt for the second. `exit();`
 * then leaves a session that is at its prompt, and the signal ends the shell
 * either way.
 *
 * @type {Array<{keys: String, wait: Number}>}
 */
const killSteps = [
  {keys: '\u0003', wait: 400},
  {keys: '\u0003', wait: 400},
  {keys: 'exit();\r', wait: 150},
]

/**
 * How long a session is given to show that the command it was started with is
 * reading the terminal. See Session#ready.
 *
 * A run written into a session whose command is not reading yet is read by
 * nobody: a command that uses readline flushes what is waiting on the terminal
 * when it takes it over, and what it flushes is the run. The wait is therefore
 * bounded rather than guessed. It is a longer bound over ssh, where the same
 * boot waits on a dial, a login and a machine that is not this one.
 */
const readyLimit = 5000
const readyLimitOverSSH = 15000

/**
 * The two escapes readline prints when it takes the terminal over and when it
 * hands it back: bracket paste on, and bracket paste off. See Session#ready.
 */
const terminalTaken = '\u001b[?2004h'
const terminalGivenUp = '\u001b[?2004l'

/**
 * What psysh prints when it reads a line: its prompt, and the prompt it reads a
 * statement that is not finished behind. The modern theme's `> ` and `. `, and
 * the classic theme's `>>> ` and `... `, each at the start of a line.
 *
 * It is how a session reading through libedit says it is reading: libedit
 * prints no bracket paste escape (see `terminalTaken`), and php on Debian,
 * Ubuntu and the official docker images reads through libedit. The prompt is
 * printed by the readline itself, once it has the terminal, so a line written
 * after it is a line that readline reads.
 */
const psyshPrompt = /(?:^|[\r\n])(?:>>>|>|\.\.\.|\.) $/

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
 * The longest tail of `text` that could still become the status marker.
 *
 * A pty hands over what it has when it has it, so a chunk can end in the middle
 * of the marker, after whatever the command printed: the tail that matters is
 * the longest one that is a prefix of the marker, not the last few characters
 * of the chunk. Holding a fixed-length slice loses a short marker that follows
 * ordinary output in the same chunk.
 *
 * @param {String} text
 * @return {String}
 */
const heldMarker = text => {
  for (let length = Math.min(bootMarker.length - 1, text.length); length > 0; length--) {
    const suffix = text.slice(-length)

    if (bootMarker.startsWith(suffix)) {
      return suffix
    }
  }

  return ''
}

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
 * What a session says when the command it was given exits while a run is going.
 *
 * The shell is what the session is, and it outlives the command: a php that was
 * killed, that crashed, or that ended under a run leaves the shell at its prompt
 * and prints the command's status before it. That status is the difference
 * between a run that is still working and one that will never answer, and it
 * names the failure in the terms a developer reading the terminal would see.
 *
 * @param {Number|null} status the status the shell reported, or null
 * @return {SessionError}
 */
const commandExitError = status => new SessionError(
  status === null
    ? 'the session\'s command exited while the run was going'
    : `the session's command exited while the run was going (exit status ${status})`,
  {status},
)

/**
 * What a session says when a command was handed the terminal and nothing ever
 * came back from it: the line is still dialing, the login never finished, or the
 * command never started. There is no output to carry, so the message is the
 * whole of it — and it is said in place of a timeout spent waiting for an answer
 * that could not come.
 *
 * @param {Object} connection
 * @return {String}
 */
const silentSessionMessage = connection =>
  connection && connection.is_over_ssh
    ? 'the session printed nothing back: the ssh line was still connecting, or its login never finished'
    : 'the session printed nothing back: its command never started reading the terminal'

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
   * @param {{appName?: String, appVersion?: String, log?: Object,
   *   dataDir?: String}} [options]
   *   what the session reports itself as (`TERM_PROGRAM`), where a session
   *   that will not start is reported, and the app's data directory — which is
   *   where a connection's saved password is answered from. No window and no
   *   electron is involved.
   */
  constructor(connection, {appName = 'Tinkr', appVersion = '', log = console, dataDir = null} = {}) {
    this.connection = connection
    this.appName = appName
    this.appVersion = appVersion
    this.log = log
    this.dataDir = dataDir
    this.pty = null
    // the command the shell was given, and how it ended: what the shell prints
    // when it exits (see bootMarker) is watched for from the first byte, because
    // a command can exit before the caller has anything to subscribe with
    this.exitObserver = null
    this.exitOrigin = null
    this.exitBuffer = ''
    this.exitOutput = ''
    this.commandExit = null
    this.exitNotified = false
    this.exitListeners = new Set()
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
    // a session with nothing to run still has to run what the connection is:
    // a connection whose project is in a container runs the container's command,
    // and one over ssh is reached before anything is typed. Asking for "no
    // command" is not asking for a bare shell on a connection that has one
    command = command || sessionCommand(this.connection) || null

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

    // a connection with a saved password is answered by the app's own helper
    // rather than by the terminal, and what it needs to find that password is
    // computed once: part of it goes into this environment and the rest onto the
    // line ssh is given (see parseSSHCommand — a login profile replaces what was
    // in the environment, and the line is read after it has run). Nothing of the
    // password itself is in either: the helper reads it from the app's own file
    const askpass = askpassEnvironment(this.dataDir, this.connection)

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

    // watched from before the line is written: a command that exits at once
    // prints its status before anyone has subscribed, and that status is the
    // only thing that says the session will never answer
    this.watchCommandExit()

    if (this.connection.is_over_ssh) {
      // the command travels inside the ssh line rather than being typed after
      // it: ssh's own prompts — a host key to accept, a password to type — read
      // the terminal it was started on, and a command written there alongside
      // ssh is what they answered instead. See parseSSHCommand.
      // The far psysh pages too, so its pager is put out of the way the same as
      // here (see withoutPager): a value taller than the terminal — any model —
      // otherwise sat behind `less`, waiting for a key, until the run timed out
      this.pty.write(`${parseSSHCommand(this.connection, command && withoutPager(command), askpass && askpass.line)}${bootSentinel}\r`)
    } else if (command) {
      // the status of the command, printed by the shell once it is back: the
      // shell's prompt is the same escape as a command's, so this is what says
      // which of the two the session is looking at (see Session#ready)
      this.pty.write(`${withoutPager(command)}${bootSentinel}\r`)
    }
  }

  /**
   * Watch the session's stream for the status the shell prints when the command
   * it was given has exited, and keep watching after the session is ready.
   *
   * The shell outlives the command: when php is killed — by a stop, by a run
   * that outlived its time, or by the machine — the shell is still there and
   * prints the status sentinel of the line it was given (see bootMarker). That
   * status is the only thing coming that says the run will never answer, so it
   * is read for the whole life of the session rather than only while it boots.
   *
   * The listener is installed once, before the command is written, so a command
   * that exits immediately is not missed between the write and a caller's
   * subscription. What it found is kept for a subscription that arrives later
   * (see onCommandExit).
   */
  watchCommandExit() {
    const pty = this.pty

    if (!pty || (this.exitObserver && this.exitOrigin === pty)) {
      return
    }

    if (this.exitObserver) {
      this.exitObserver.dispose()
    }

    this.exitOrigin = pty
    this.exitBuffer = ''
    this.exitObserver = pty.onData(data => this.noteCommandExit(data))
  }

  /**
   * Read the stream for the status sentinel of the command the shell was given.
   *
   * The sentinel is watched across chunks: a pty hands over what it has when it
   * has it, and the marker, the digits and the bell can each end one chunk and
   * begin the next. What may be the start of a marker is held back until the
   * next chunk completes it or rules it out.
   *
   * @param {String} data
   */
  noteCommandExit(data) {
    if (this.commandExit) {
      return
    }

    const buffer = `${this.exitBuffer}${data}`
    const at = buffer.indexOf(bootMarker)

    if (at === -1) {
      // the longest tail that could still become the marker is what is held:
      // the chunk's last few characters are not, when the marker follows the
      // command's output in the same chunk
      this.exitBuffer = heldMarker(buffer)

      return
    }

    const rest = buffer.slice(at + bootMarker.length)
    const end = rest.search(/\D/)

    // the status is digits and the bell (see bootSentinel): a chunk that stops
    // among the digits is the frame continuing, and anything but the bell after
    // them is not the frame the shell prints at all — the marker never appears
    // in a project's output (see bootMarker)
    if (end === -1) {
      this.exitBuffer = buffer.slice(at)

      return
    }

    if (rest[end] !== '\u0007') {
      this.exitBuffer = ''

      return
    }

    const digits = rest.slice(0, end)

    this.exitBuffer = ''
    // what came before the sentinel in this chunk, which is output of the
    // command that just ended: the boot carries it into its own failure (see
    // ready), and a run has already printed it to its pane
    this.exitOutput = buffer.slice(0, at)
    this.commandExit = commandExitError(digits === '' ? null : Number(digits))

    // deferred rather than called here: this listener was installed before any
    // other, so a run's envelope in the same chunk would otherwise be read
    // after the exit had already answered the run. Deferring lets every listener
    // for this chunk — the filter that reads the value — finish first
    Promise.resolve().then(() => this.notifyCommandExit())
  }

  /**
   * Tell everyone waiting for the command's exit, once.
   */
  notifyCommandExit() {
    if (this.exitNotified) {
      return
    }

    this.exitNotified = true

    const listeners = Array.from(this.exitListeners)

    this.exitListeners.clear()
    listeners.forEach(cb => cb(this.commandExit))
  }

  /**
   * Answer once the command the shell was given has exited, after the session
   * is ready as well as before it.
   *
   * The session keeps watching from the moment it starts, so a subscription made
   * after the exit still hears about it. The answer is delivered on a later turn
   * of the event loop, so the caller that subscribes has finished setting its own
   * listeners up, and so that anything read from the same chunk — a run's
   * envelope — is read first (see noteCommandExit).
   *
   * @param {Function} cb
   * @return {Object} what the observer is dropped through
   */
  onCommandExit(cb) {
    this.exitListeners.add(cb)

    if (this.commandExit && this.exitNotified) {
      Promise.resolve().then(() => {
        if (this.exitListeners.delete(cb)) {
          cb(this.commandExit)
        }
      })
    }

    return {dispose: () => this.exitListeners.delete(cb)}
  }

  /**
   * @param {Function} cb
   * @return {Object} what the pty is listened to through, so it can be dropped
   */
  onData(cb) {
    return this.pty.onData(cb)
  }

  /**
   * A real end of the pty: the shell itself went away.
   *
   * @param {Function} cb
   * @return {Object} what the pty is listened to through, so it can be dropped
   */
  onExit(cb) {
    return this.pty.onExit(cb)
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
   * along with the prompt it prints next. libedit takes it without the escape,
   * so psysh's own prompt after the handover is the same sign (see
   * `psyshPrompt`). A session is written into once the command has taken the
   * terminal — that, and nothing else, is what a command reading its terminal
   * looks like.
   *
   * Silence is not that. A line that is still dialing, a login that is reading
   * its own files and a command that has not booted yet are all silent, and a
   * run written into any of them is answered by nobody: readline flushes what
   * was waiting on the terminal when it takes it over, which is how a session
   * that looked ready spent the whole run timeout and answered with a timeout.
   * So the wait is bounded instead of guessed, and it ends in one of two ways
   * (see `readyLimit`): the command says it is reading, or it printed something
   * after the terminal was handed to it — a command that does not use readline
   * takes the terminal without saying so, and its own prompt is the sign it is
   * up. A command that was handed the terminal and answered with nothing at all
   * never got anywhere, and that is what the session says, at the limit, in
   * place of a timeout later.
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
   * before it takes the terminal, or when it printed nothing back at all
   */
  ready() {
    return new Promise((resolve, reject) => {
      const pty = this.pty

      if (!pty) {
        resolve()

        return
      }

      // a session built by hand — a test, or a caller that set its own pty —
      // has no observer yet, and the status of the command is read by the same
      // watcher either way
      this.watchCommandExit()

      // the command may have exited before this wait began: the watcher reads
      // from the first byte, so what it already knows is the whole answer
      if (this.commandExit) {
        const status = this.commandExit.status
        const output = stripSessionNotes(this.exitOutput).replace(/\r\n/g, '\n').trim()

        reject(new SessionError(sessionFailureMessage(output, status), {output, status}))

        return
      }

      let limit = null
      let listener = null
      let handedBack = false
      let shellTook = false
      let printed = false
      let booted = ''

      const limitAt = (this.connection && this.connection.is_over_ssh) ? readyLimitOverSSH : readyLimit

      const settle = () => {
        clearTimeout(limit)
        listener.dispose()
        resolve()
      }

      const fail = (status, message = null) => {
        clearTimeout(limit)
        listener.dispose()

        const output = stripSessionNotes(booted).replace(/\r\n/g, '\n').trim()

        reject(new SessionError(message || sessionFailureMessage(output, status), {output, status}))
      }

      listener = pty.onData(data => {
        // the shell printed the status of the command it was given, so the
        // command has exited and the terminal is the shell's again. The watcher
        // installed above reads the sentinel across chunks and was called with
        // this chunk before this listener was, so the exit is already known
        if (this.commandExit) {
          // what the command printed follows the handover and precedes the
          // status, and it is the whole of the answer when there is none
          booted += this.exitOutput

          fail(this.commandExit.status)

          return
        }

        const taken = data.lastIndexOf(terminalTaken)
        const given = data.lastIndexOf(terminalGivenUp)

        // what the command prints is what explains a boot that failed, so it is
        // kept from the handover — before that the terminal is the shell's, and
        // what it prints there is the line it was given, echoed back
        if (handedBack) {
          booted += data

          if (booted.length > bootOutputLimit * 4) {
            booted = booted.slice(-bootOutputLimit)
          }

          if (stripSessionNotes(data).trim() !== '') {
            printed = true
          }

          // psysh printed its prompt: libedit has the terminal, and says so no
          // other way. Only the end of what came back is read, which is where a
          // prompt that is waiting for a line is
          if (psyshPrompt.test(stripRendering(booted.slice(-256)))) {
            settle()

            return
          }
        }

        // the command took the terminal in the same breath the shell gave it up
        if (given !== -1 && taken > given) {
          settle()

          return
        }

        if (given !== -1) {
          handedBack = true

          return
        }

        // a take after the shell gave the terminal up is the command reading. A
        // take before that is the shell's own prompt, which says nothing about
        // whether the command is up — that is what `shellTook` records, and it
        // is also all a shell without readline gives (see the limit below)
        if (taken !== -1) {
          if (handedBack || shellTook) {
            settle()
          } else {
            shellTook = true
          }
        }

        // nothing else settles this: the shell has said it is reading and has
        // not handed the terminal over, and a run written into it now is what
        // the line limit cuts
      })

      limit = setTimeout(() => {
        // nothing was ever handed the terminal — a shell without readline — so
        // what came back is the whole of what there is to go on
        if (!handedBack) {
          settle()

          return
        }

        // a command that printed after it was given the terminal is up, even
        // when it never says it is reading; one that printed nothing at all
        // never got anywhere, and waiting the run timeout out for it is an
        // answer the caller can do nothing with
        if (printed) {
          settle()

          return
        }

        fail(null, silentSessionMessage(this.connection))
      }, limitAt)
    })
  }

  /**
   * @param {String} code
   */
  write(code) {
    this.pty.write(code)
  }

  /**
   * Type a run into the session, a line at a time, each once the session has
   * read the one before it.
   *
   * A line typed ahead of the readline is read by the terminal instead: between
   * two lines psysh has handed the terminal back, and what arrives then is echoed
   * by the terminal itself, out of order with what the readline echoes, so the
   * echo of the run is torn into pieces the pane cannot tell from what the run
   * printed. Waiting for psysh's prompt between lines keeps the echo whole, and
   * the lines few (see runResult.typedRun) keeps the wait short.
   *
   * A session that never shows the prompt — a theme of its own, a command that is
   * not psysh — is handed the rest at once at the readiness limit rather than
   * left waiting on a prompt that is not coming.
   *
   * @param {Array<String>} lines without their line endings
   * @return {Promise<void>} once the last line is written
   */
  type(lines) {
    return new Promise(resolve => {
      const pty = this.pty

      if (!pty || lines.length === 0) {
        resolve()

        return
      }

      const limitAt = (this.connection && this.connection.is_over_ssh) ? readyLimitOverSSH : readyLimit
      let index = 0
      let since = ''
      let limit = null
      let listener = null

      const done = () => {
        clearTimeout(limit)
        listener.dispose()
        resolve()
      }

      const next = () => {
        clearTimeout(limit)

        // a session killed while it was being typed into is not written into
        if (this.pty !== pty) {
          done()

          return
        }

        since = ''
        pty.write(`${lines[index]}\r`)
        index++

        if (index === lines.length) {
          done()

          return
        }

        limit = setTimeout(() => {
          if (this.pty === pty) {
            pty.write(lines.slice(index).map(line => `${line}\r`).join(''))
          }

          done()
        }, limitAt)
      }

      listener = pty.onData(data => {
        since = (since + data).slice(-256)

        if (psyshPrompt.test(stripRendering(since))) {
          next()
        }
      })

      next()
    })
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

    // the session is ending: a status the dying command prints as it goes is
    // not an answer to anything
    if (this.exitObserver) {
      this.exitObserver.dispose()
    }

    this.exitObserver = null
    this.exitOrigin = null
    this.exitListeners.clear()

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
const runOutput = filter => stripSessionNotes(filter.printedText()).replace(/\r\n/g, '\n').trim()

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
 * A connection whose code runs on Laravel Cloud has no session to run it in: it
 * goes through the API instead (see cloud.runCloud), and answers with the same
 * shape plus the id of the command that ran it.
 *
 * @param {Record<String, any>} connection
 * @param {String} code
 * @param {{timeout?: Number, command?: String, guard?: String, appName?: String,
 *   appVersion?: String, log?: Object, dataDir?: String, token?: String,
 *   signal?: AbortSignal, fetch?: Function, interval?: Number}} [options] `command` is
 *   what the session is started with when the connection names none, `guard` is
 *   what the run is guarded with: `rollback` for a dry run, `commit` for the
 *   same run kept, `dataDir` is where the app's data is — which is where a
 *   connection's saved password is answered from — and `token` is a Laravel
 *   Cloud token for a cloud connection, which is read from that same data
 *   directory when the caller has none. `signal` stops a run, `fetch` replaces
 *   the one a cloud run talks to the API with, and `interval` is how often it
 *   asks how the command is going. `timeout` is how long the run may take, and
 *   zero is no limit: the run is still answered when its command exits (see
 *   Session#onCommandExit)
 * @return {Promise<{value: any, blocks: Array, error: Object|null,
 *   queries: Array, queriesTotal: Number, imported?: Object,
 *   transaction?: Object, output: String, commandId?: String}>}
 *   `queries` is what the run sent to its connections (see runResult.QUERY_BLOCK),
 *   and `queriesTotal` counts every query the run sent, stored or not.
 *   `transaction` is what a guarded run did with the transaction it was sent
 *   under (see runResult.guardArm), and a run without a guard is not sent one
 */
const runCode = (connection, code, options = {}) => {
  const {timeout = 30000, guard = null} = options

  // a connection on Laravel Cloud has no shell to reach: its run is a command
  // sent to the API, and nothing of the session below — a pty, a boot, a kill —
  // exists there. Its own imports are read from the local checkout when the
  // connection names one, which is the only way a cloud run knows this project's
  // classes: the environment cannot be read from here
  if (isCloud(connection)) {
    return runCloud(connection, code, {
      token: options.token || cloudTokenOf(options.dataDir),
      guard,
      timeout,
      signal: options.signal,
      fetch: options.fetch,
      interval: options.interval,
      imports: connection.path ? importsFor(connection.path, code) : {},
    })
  }

  // what the session starts with: what the caller asked for, and otherwise what
  // the connection was saved with — which, for a connection whose project is in
  // a container, is the container's command rather than a command that assumes
  // the php is on the machine. A run with neither would be written into a bare
  // shell, which answers nothing and ends in a timeout that says nothing about
  // why
  const command = options.command || sessionCommand(connection) || null
  const session = new Session(connection, options)
  // a session over ssh runs in the remote project, whose composer files are not
  // on this machine to read
  const imports = !connection.is_over_ssh && connection.path
    ? importsFor(connection.path, code)
    : {}
  const run = wrapRun(code, imports, guard, timeout)
  const filter = new RunResultFilter(run.marker, run.start)

  return new Promise((resolve, reject) => {
    let settled = false
    let booted = false

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

    // a timeout of zero or less is a run given no limit, which is what the
    // preference says when it is cleared: a run whose command dies is still
    // answered, because the status of that command is watched for below
    const timer = timeout > 0
      ? setTimeout(() => finish(new Error(`the session did not answer within ${timeout}ms`)), timeout)
      : null

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

    // the command the shell was given has exited: php was killed, it crashed,
    // or it ended. Nothing is coming from it any more, and this is the answer —
    // the status the shell printed, instead of waiting out a timeout that is no
    // longer the reason nothing came back. A session that never booted is
    // answered by ready() with the command's own words, so this listens from
    // the moment the session is up
    session.onCommandExit(error => {
      if (!booted) {
        return
      }

      // what the run printed before php died is part of its answer: the error
      // says how it ended, and it does not replace the output it left
      error.output = runOutput(filter)

      finish(error)
    })

    // the run goes in once the command is reading the terminal: handed over
    // before that, anything past the terminal's own buffer is dropped and the
    // run is parsed in half. See Session#ready
    session.ready().then(() => {
      if (settled || !session.pty) {
        return
      }

      booted = true

      // a line at a time: one line of the whole run is more than libedit reads
      // (see runResult.typedRun)
      return session.type(typedRun(run.code))
    }).catch(error => finish(error))

    session.onExit(() => {
      const error = new SessionError('the session exited before it answered')

      // a shell that went away after the run started leaves what the run
      // printed in the filter, the same as a command exit does
      if (booted) {
        error.output = runOutput(filter)
      }

      finish(error)
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
