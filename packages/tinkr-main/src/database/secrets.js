const fs = require('fs')
const path = require('path')
const log = require('electron-log')

const {secretsFile, CLOUD_SECRET_KEY} = require('tinkr-core')

/**
 * What a connection that logs in with a password needs kept, and where.
 *
 * A password is not a preference and it is not a field of a connection: the
 * connections store is read whole by the window, written whole on every edit,
 * and handed to the MCP server as a json document. So the password lives in a
 * file of its own, one entry per connection, and the connection carries only the
 * fact that one is there (`ssh_password`).
 *
 * Nothing hands the password back. A session's helper reads this file itself
 * (see tinkr-core's sshAskpass), so the password is never in a connection
 * object, never in an ipc message, and never in the window's memory.
 *
 * The Laravel Cloud API token is kept in the same file, under a key of its own
 * (`CLOUD_SECRET_KEY`, which no connection id can be). It is one token for the
 * whole app rather than one per connection: it names who is asking Laravel
 * Cloud, and every cloud connection asks as that one person. Nothing hands it
 * back either — the window is told whether there is one, never what it is.
 *
 * It is written 0600: the same protection ssh's own files have, against the same
 * person the session already runs as.
 */

/**
 * The secrets, as the file holds them.
 *
 * A file that cannot be read is an empty one rather than an error: a password
 * that has gone is a connection that asks for it again, which is better than an
 * app that will not start.
 *
 * @param {String} dir the app's data directory
 * @return {Object}
 */
const read = dir => {
  if (!dir) {
    return {}
  }

  try {
    const data = JSON.parse(fs.readFileSync(secretsFile(dir), 'utf8'))

    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch (e) {
    return {}
  }
}

/**
 * Write the secrets, with a file only its owner can read.
 *
 * It is written whole, through a temporary file and a rename, so a write that is
 * cut off leaves the file that was there: the app and the MCP server both write
 * it, and neither can leave the other half a document.
 *
 * @param {String} dir
 * @param {Object} secrets
 */
const write = (dir, secrets) => {
  const file = secretsFile(dir)
  const temporary = `${file}.${process.pid}.tmp`

  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700})
  fs.writeFileSync(temporary, JSON.stringify(secrets, null, 2), {mode: 0o600})
  fs.renameSync(temporary, file)

  try {
    fs.chmodSync(file, 0o600)
  } catch (e) {
    // windows sets no mode, and the file sits in the user's own profile
  }
}

/**
 * Keep a password for a connection.
 *
 * An empty password is a password that was removed, which is the same as the
 * connection not having one.
 *
 * @param {String} dir
 * @param {String} id
 * @param {String} password
 */
const set = (dir, id, password) => {
  // the key the Cloud token lives under is not a connection's: one written
  // through here would be a password replacing the token, and forgetting one
  // would be the app forgetting who it asks Laravel Cloud as
  if (!dir || !id || id === CLOUD_SECRET_KEY) {
    return
  }

  const secrets = read(dir)

  if (password === null || password === undefined || password === '') {
    delete secrets[id]
  } else {
    secrets[id] = String(password)
  }

  try {
    write(dir, secrets)
  } catch (e) {
    // a password that could not be written is one the connection asks for
    // again in its terminal: the session still runs, and nothing of the
    // password reaches the log
    log.error('[secrets] the password of a connection could not be kept:', e.message)
  }
}

/**
 * Forget the password of a connection.
 *
 * @param {String} dir
 * @param {String} id
 */
const forget = (dir, id) => set(dir, id, '')

/**
 * Whether a connection has a password kept.
 *
 * @param {String} dir
 * @param {String} id
 * @return {Boolean}
 */
const has = (dir, id) => Boolean(id) && id !== CLOUD_SECRET_KEY && typeof read(dir)[id] === 'string'

/**
 * The Laravel Cloud API token, or nothing when none is saved.
 *
 * It is handed back here because the main process is what asks Laravel Cloud
 * anything: the window checks it, lists applications with it, but never holds a
 * token of its own to ask with. A file that has gone, or one written by an
 * older version, is no token rather than an error — the app says a token is
 * needed and the settings screen is where one goes.
 *
 * @param {String} dir
 * @return {String}
 */
const cloudToken = dir => {
  const token = read(dir)[CLOUD_SECRET_KEY]

  return typeof token === 'string' ? token : ''
}

/**
 * Keep the Laravel Cloud API token.
 *
 * The token is written only once something has answered with it (see
 * ipc.setCloudToken): a token that Laravel Cloud refuses is one to say so
 * about, not one to keep and fail every run with afterwards. An empty token is
 * a token removed, the same way an empty password is.
 *
 * @param {String} dir
 * @param {String} token
 * @return {Boolean} whether it was written
 */
const setCloudToken = (dir, token) => {
  if (!dir) {
    return false
  }

  const secrets = read(dir)
  const worth = typeof token === 'string' ? token.trim() : ''

  if (worth === '') {
    delete secrets[CLOUD_SECRET_KEY]
  } else {
    secrets[CLOUD_SECRET_KEY] = worth
  }

  try {
    write(dir, secrets)
  } catch (e) {
    // nothing of the token reaches the log: a write that failed is a token the
    // settings screen is told did not save
    log.error('[secrets] the Laravel Cloud token could not be kept:', e.message)

    return false
  }

  return true
}

/**
 * Forget the Laravel Cloud API token.
 *
 * @param {String} dir
 */
const forgetCloudToken = dir => setCloudToken(dir, '')

/**
 * Whether a Laravel Cloud API token is saved. This is the only thing about the
 * token the window is ever told.
 *
 * @param {String} dir
 * @return {Boolean}
 */
const hasCloudToken = dir => cloudToken(dir) !== ''

/**
 * What the app keeps of a connection that was just saved.
 *
 * The form autosaves on every edit and never shows a saved password back, so a
 * field that is empty means "no change" and not "remove it": typing a password
 * keeps it, leaving the one that is there alone keeps it, and forgetting one is
 * the separate act the form offers for it (see forgetPassword).
 *
 * What is stored never holds the password itself, only whether one is kept, and
 * that flag is made to say what the file actually holds rather than what the
 * window believed: the file is written by the MCP server too.
 *
 * @param {String} dir
 * @param {Object} connection the connection as the window sent it
 * @param {Object} [saved] the connection as it was stored until now
 * @return {Object} the connection to store
 */
const keptConnection = (dir, connection, saved) => {
  const next = Object.assign({}, connection)
  const typed = typeof next.password === 'string' ? next.password : ''

  delete next.password

  // a connection that is not over ssh has nothing to log in with, and a
  // password left over from when it was is one nobody can use
  if (!next.is_over_ssh) {
    if (saved && saved.ssh_password) {
      forget(dir, next.id)
    }

    next.ssh_password = false

    return next
  }

  if (typed !== '') {
    set(dir, next.id, typed)
  }

  next.ssh_password = has(dir, next.id)

  return next
}

module.exports = {
  read,
  write,
  set,
  forget,
  has,
  cloudToken,
  setCloudToken,
  forgetCloudToken,
  hasCloudToken,
  keptConnection,
}
