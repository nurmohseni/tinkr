const {inContainer, containerRead} = require('tinkr-core')

const {Pty} = require('../pty/Pty')
const {phpVersionOf} = require('../utils/phpVersion')

// how long a connection gets to answer with a version before it is taken as one
// that has none: a shell that is there answers in a moment, one that is not
// never will
const detectTimeout = 5000

// what a session runs when neither the connection nor its container names a
// command, which is what the app starts a plain connection with
const defaultCommand = 'php artisan tinker'

/**
 * The command a session for this connection actually runs, in the shell it runs
 * it in.
 *
 * A container's session ignores the connection's own command and builds
 * `docker exec … <container_command>` instead (see containerCommand), so the
 * command that counts for a container is the one stored for inside it. A local
 * or ssh connection runs the command it stores — over ssh the command is the
 * far side of the ssh line, but its words are the same — and falls back to the
 * app's default when it stores none.
 *
 * @param {Record<String, any>} connection
 * @return {String}
 */
const sessionLineOf = connection => {
  if (inContainer(connection)) {
    return String(connection.container_command || '').trim() || defaultCommand
  }

  return String((connection && connection.command) || '').trim() || defaultCommand
}

/**
 * How a connection's php is asked for its version, without the `-v`.
 *
 * The words up to the php word are kept along with it, and so are its flags:
 * they are what reaches the php the session runs. `php83 artisan tinker` is
 * `php83`, `php -d memory_limit=1G artisan tinker` is `php -d
 * memory_limit=1G`, and `lerd php artisan tinker` or `docker exec app php
 * artisan tinker` are kept whole — asking this machine's `php` instead would
 * answer a version the session never runs.
 *
 * A command that names no php at all — `sail artisan tinker`, `./vendor/bin/sail
 * tinker` — reaches its php some other way, and no prefix of it can ask that
 * php anything; `null` says so rather than guessing.
 *
 * @param {Record<String, any>} connection
 * @return {String|null}
 */
const phpBinaryOf = connection => {
  // a shell command is split into words, so the answer is a run of them up to
  // the program the php runs — `artisan`, `-a`, a file, or nothing
  const words = sessionLineOf(connection).split(/\s+/)
  const at = words.findIndex(word => /(^|\/)php(\d+(\.\d+)?)?$/.test(word))

  if (at === -1) {
    return null
  }

  // php's flags come in two shapes: `-d` and the value after it, and `-dvalue`.
  // The value of the first shape is a word of its own and belongs to the flag,
  // which is why a plain "stop at the first word that is not a flag" loses
  // `memory_limit=1G` from `php -d memory_limit=1G artisan tinker`
  const takesValue = new Set(['-d', '-c', '-z', '-f', '-r', '-S', '-t', '-l', '-e'])
  const kept = []
  let wantsValue = false

  for (let index = at + 1; index < words.length; index++) {
    const word = words[index]

    if (wantsValue) {
      kept.push(word)
      wantsValue = false
      continue
    }

    if (word.startsWith('-')) {
      kept.push(word)
      wantsValue = takesValue.has(word)
      continue
    }

    break
  }

  return [...words.slice(0, at), words[at], ...kept].join(' ')
}

/**
 * Ask a connection's own shell what php it has, and tell its window.
 *
 * The question is put through the same words the session's own command goes
 * through — the same exec into a container, the same wrapper, the same ssh —
 * because that is the php a run will use. The answer is the version itself, so
 * it is read as soon as it arrives, and a connection that has none is only
 * waited on.
 *
 * A connection that answers with a version has one; one that answers with
 * nothing, or does not answer at all, has none — which is what the window draws
 * on. A command whose php cannot be read from it at all is neither: nothing is
 * asked, and the window is told that the answer is not knowable, so it neither
 * warns about a missing php nor shows a version.
 *
 * @param {Record<String, any>} connection
 * @param {Electron.BrowserWindow} win
 */
const detectPhpVersion = (connection, win) => {
  if (!win || win.isDestroyed()) {
    return
  }

  const binary = phpBinaryOf(connection)
  const question = binary && `${binary} -v`

  // a container's php is inside the container, not on the machine the shell
  // reaches: the question goes through the same exec a read does
  const command = question && (inContainer(connection) ? containerRead(connection, question) : question)

  if (!command) {
    // a command that names no php, or a container with no name to exec into, is
    // one whose php is not knowable from it: asking this machine's php would
    // answer a version the session never runs, and warning that php is missing
    // would warn about the wrong machine
    win.webContents.send('phpVersion', {version: null, unknown: true})

    return
  }

  const pty = new Pty(connection)
  let output = ''
  let done = false
  let timer = null

  const finish = () => {
    if (done) {
      return
    }

    done = true

    clearTimeout(timer)
    onData.dispose()
    pty.kill()

    const version = phpVersionOf(output)

    win.webContents.send('phpVersion', {version})
  }

  pty.connect(command)

  const onData = pty.onData(data => {
    output += data

    // the answer is the version itself: the shell echoing the line it was given
    // says `php -v`, which is no version, and what follows a version is the
    // copyright, whatever it says
    if (phpVersionOf(output)) {
      finish()
    }
  })

  timer = setTimeout(finish, detectTimeout)
}

module.exports = {
  detectPhpVersion,
  phpBinaryOf,
}
