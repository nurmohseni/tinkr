const {Pty} = require('../pty/Pty')
const {phpVersionOf} = require('../utils/phpVersion')

// how long a connection gets to answer with a version before it is taken as one
// that has none: a shell that is there answers in a moment, one that is not
// never will
const detectTimeout = 5000

/**
 * The php a connection's session runs, from the command it starts with.
 *
 * `php artisan tinker` is `php`, `php83 artisan tinker` is `php83`, and
 * `php -d memory_limit=1G artisan tinker` is `php -d memory_limit=1G` — the
 * binary and the flags between it and the program it runs. A command that is a
 * container or a wrapper is asked the same way: `docker exec app php artisan
 * tinker` answers the php inside it.
 *
 * @param {Record<String, any>} connection
 * @return {String}
 */
const phpBinaryOf = connection => {
  const command = String(connection.command || '').trim()

  if (!command) {
    return 'php'
  }

  // a shell command is split into words, so the answer is the words up to the
  // program the php runs — `artisan`, `-a`, a file, or nothing
  const words = command.split(/\s+/)
  const at = words.findIndex(word => /(^|\/)php(\d+(\.\d+)?)?$/.test(word))

  if (at === -1) {
    // a command that names no php at all — `docker exec app tail -f x` — is one
    // whose php is not knowable from it, and the plain question is the best
    // answer there is
    return 'php'
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

  return [words[at], ...kept].join(' ')
}

/**
 * Ask a connection's own shell what php it has, and tell its window.
 *
 * The question is put to the shell the session runs in — the same machine, the
 * same path, the same ssh — because that is the php a run will use. The answer
 * is the version itself, so it is read as soon as it arrives, and a connection
 * that has none is only waited on.
 *
 * A connection that answers with a version has one; one that answers with
 * nothing, or does not answer at all, has none — which is what the window draws
 * on.
 *
 * @param {Record<String, any>} connection
 * @param {Electron.BrowserWindow} win
 */
const detectPhpVersion = (connection, win) => {
  if (!win || win.isDestroyed()) {
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

  // the question is put to the php the connection's own command runs, not to
  // whatever `php` is on the path: a connection that starts `php83 artisan
  // tinker` or `docker exec app php artisan tinker` runs that php, and a
  // connection whose ssh never came up used to answer with this machine's php.
  // The binary is the first word of the command, and it keeps its own flags
  pty.connect(`${phpBinaryOf(connection)} -v`)

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
