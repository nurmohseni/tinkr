const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

/**
 * Files that more than one process writes.
 *
 * The app's own json — the snippets above all — is written by the app and by
 * every MCP server a client has started, and two clients (Claude Code and
 * Cursor, say) each start their own. A read, a change and a write back done by
 * two of them at once keeps only one of the changes, and a file written in place
 * is half a file to anyone who reads it meanwhile. So a write here goes to a
 * file of its own first and is renamed over the old one, which a reader sees
 * either whole or not at all, and a change of a file's contents is made under a
 * lock every writer takes.
 */

// how long a lock may be held before it is taken to be left over by a process
// that died holding it: a snippet's write takes milliseconds
const staleLock = 10000

// how long a writer waits for the lock before it gives up and says so
const lockWait = 10000

/**
 * @param {Number} ms
 */
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Read a json file, or nothing when it is not there.
 *
 * A file that is there and cannot be read is not nothing: answering it as empty
 * is how a change made on top of it deletes everything it held. It is an error,
 * with the file named, and the file is left as it is.
 *
 * @param {String} file
 * @return {any} null when there is no file
 */
const readJson = file => {
  let text

  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null
    }

    throw new Error(`${file} could not be read: ${e.message}`)
  }

  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}), so it was left as it is.`)
  }
}

/**
 * Write a file so that whoever reads it meanwhile reads the old one or the new
 * one, never part of either: the contents go to a file beside it, and that file
 * is renamed over it.
 *
 * @param {String} file
 * @param {String} contents
 * @param {Number} [mode] the permissions it is written with: the old file's, when
 * there is one, so a configuration that holds a token stays as private as it was
 */
const writeAtomic = (file, contents, mode) => {
  fs.mkdirSync(path.dirname(file), {recursive: true})

  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`

  try {
    const fd = fs.openSync(temporary, 'wx', mode === undefined ? 0o666 : mode)

    try {
      fs.writeFileSync(fd, contents)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }

    if (mode !== undefined) {
      fs.chmodSync(temporary, mode)
    }

    rename(temporary, file)
  } catch (e) {
    fs.rmSync(temporary, {force: true})

    throw e
  }
}

/**
 * A rename over a file that windows has open for a moment (an antivirus, an
 * indexer, the app reading it) fails rather than waits: it is tried again for a
 * little while before it counts as a failure.
 *
 * @param {String} from
 * @param {String} to
 */
const rename = (from, to) => {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to)

      return
    } catch (e) {
      if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) {
        throw e
      }

      sleep(25)
    }
  }
}

/**
 * @param {String} lock
 * @return {Boolean} whether the lock was left by a process that is gone, or has
 * been held for longer than any write takes
 */
const isStale = lock => {
  let stat
  let owner

  try {
    stat = fs.statSync(lock)
    owner = JSON.parse(fs.readFileSync(lock, 'utf8'))
  } catch (e) {
    // a lock that is being written, or was just removed: not stale, look again
    return Boolean(stat) && Date.now() - stat.mtimeMs > staleLock
  }

  if (Date.now() - stat.mtimeMs > staleLock) {
    return true
  }

  if (owner && owner.host === os.hostname() && Number.isInteger(owner.pid)) {
    try {
      process.kill(owner.pid, 0)
    } catch (e) {
      return e.code === 'ESRCH'
    }
  }

  return false
}

/**
 * Run `fn` holding the lock of `file`, across processes: the app and every MCP
 * server take the same one before they change the file.
 *
 * The lock is a file of its own, created only if it is not there (`wx`), which
 * is a single step for the filesystem whoever else is trying. A lock its owner
 * left behind — it crashed, or was killed mid-write — is taken over once its
 * process is gone or it is older than any write takes.
 *
 * @param {String} file the file the lock is for
 * @param {Function} fn
 * @return {any} what fn answers
 */
const withLock = (file, fn) => {
  const lock = `${file}.lock`
  const token = crypto.randomBytes(8).toString('hex')
  const deadline = Date.now() + lockWait

  fs.mkdirSync(path.dirname(file), {recursive: true})

  for (;;) {
    try {
      fs.writeFileSync(lock, JSON.stringify({pid: process.pid, host: os.hostname(), token}), {flag: 'wx'})

      break
    } catch (e) {
      if (e.code !== 'EEXIST') {
        throw e
      }
    }

    if (isStale(lock)) {
      fs.rmSync(lock, {force: true})

      continue
    }

    if (Date.now() > deadline) {
      throw new Error(`${file} is being written by another process (${lock} is held), so nothing was changed. Try again.`)
    }

    sleep(5 + Math.floor(Math.random() * 10))
  }

  try {
    return fn()
  } finally {
    try {
      // a lock that was taken over as stale is someone else's now
      if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) {
        fs.rmSync(lock, {force: true})
      }
    } catch (e) {
    }
  }
}

/**
 * @param {String} file
 * @return {String|null} what a file is, so a change of it can be seen: a file
 * replaced by a rename is a new inode
 */
const versionOf = file => {
  try {
    const stat = fs.statSync(file, {bigint: true})

    return `${stat.ino}:${stat.size}:${stat.mtimeNs}`
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null
    }

    throw e
  }
}

/**
 * Change a json object file: read it, hand it to `change`, and write what comes
 * back, under the lock and atomically.
 *
 * A writer that does not take the lock — an older app, someone's script — is
 * seen rather than overwritten: when the file is not the one that was read by
 * the time the change is to be written, the change is made again on top of what
 * is there now. And the change is read back once it is written, so one that was
 * overwritten anyway is made again.
 *
 * @param {String} file
 * @param {Function} change takes the object and answers the object to write
 * @param {Function} [kept] takes the object as it was read back, and says
 * whether the change is in it
 * @return {Object} what was written
 */
const updateJson = (file, change, kept = () => true) => withLock(file, () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const version = versionOf(file)
    const stored = readJson(file)

    if (stored !== null && (typeof stored !== 'object' || Array.isArray(stored))) {
      throw new Error(`${file} does not hold a JSON object, so it was left as it is.`)
    }

    if (versionOf(file) !== version) {
      continue
    }

    const next = change(Object.assign({}, stored))
    const contents = JSON.stringify(next, null, '\t')
    let mode

    try {
      mode = fs.statSync(file).mode & 0o777
    } catch (e) {
    }

    // the last moment a writer without the lock can still be seen
    if (versionOf(file) !== version) {
      continue
    }

    writeAtomic(file, contents, mode)

    if (kept(readJson(file) || {})) {
      return next
    }
  }

  throw new Error(`${file} kept changing while it was written, so the change was not kept. Try again.`)
})

module.exports = {
  readJson,
  writeAtomic,
  withLock,
  updateJson,
  staleLock,
}
