const log = require('electron-log')

const {Pty} = require('../pty/Pty')
const {phpVersionOf} = require('../utils/phpVersion')

// how long a connection gets to answer with a version before it is taken as one
// that has none: a shell that is there answers in a moment, one that is not
// never will
const detectTimeout = 5000

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

  log.info('[php] asking', connection.name)

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

    log.info('[php]', connection.name, 'answered', version || 'nothing')

    win.webContents.send('phpVersion', {version})
  }

  // the shell has to be up before its output can be listened to: a pty that was
  // never connected has nothing to subscribe to. Nothing is missed by the order,
  // since a shell cannot write before this tick is over.
  pty.connect('php -v')

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
}
