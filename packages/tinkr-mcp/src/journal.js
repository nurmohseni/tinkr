const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const {readJson, writeAtomic} = require('./files')

/**
 * What MCP clients did through this server, kept where the app can show it.
 *
 * A session is one server process: a client starts the server, says who it is
 * in the handshake, calls tools, and closes the pipe. Every client starts its
 * own, and several run at once (Claude Code and Cursor side by side), so each
 * session is a file of its own that only its own process writes. That way no
 * writer waits for a lock, and none of them can lose another's calls. The app
 * only reads these files, and deletes the ones whose session has ended when
 * it is asked to clear them.
 *
 * A file is the whole session, written again after every call through a
 * rename, so the app reads either the session as it was or as it now is,
 * never half of it.
 */

// how many sessions are kept: the oldest go when a new one starts
const keptSessions = 100

// how many calls of one session are kept: the newest, with the total beside them
const keptCalls = 200

// how much of a call's code and of its error is kept: enough to read what it
// was and to open it again, not a copy of everything a client sent. Code that
// is longer is kept cut and marked, so it is never opened as if it were whole
const keptCode = 20000
const keptError = 500

// the tools that run code: the value a run returned is what its outcome says
const runTools = ['tinkr_run_php', 'tinkr_run_php_over_ssh']

const directoryOf = dataDir => path.join(dataDir, 'app', 'mcp')

const fileOf = (dataDir, id) => path.join(directoryOf(dataDir), `${id}.json`)

/**
 * @param {String} text
 * @param {Number} length
 * @return {String}
 */
const cut = (text, length) => (text.length > length ? `${text.slice(0, length)}…` : text)

/**
 * What a call did, in the app's three words: a run returned a value, a run
 * only printed, or the call threw. A tool that is not a run and answered
 * returned what it was asked for.
 *
 * @param {String} tool
 * @param {Object} answer what the tool answered with
 * @return {String} `returned`, `printed` or `threw`
 */
const outcomeOf = (tool, answer) => {
  const structured = (answer && answer.structuredContent) || {}

  if (!answer || answer.isError || structured.error) {
    return 'threw'
  }

  if (runTools.includes(tool) && (structured.value === null || structured.value === undefined)) {
    return 'printed'
  }

  return 'returned'
}

/**
 * @param {Object} answer
 * @return {String|null} what went wrong, as one line a list can show
 */
const errorOf = answer => {
  const structured = (answer && answer.structuredContent) || {}

  if (structured.error && typeof structured.error.message === 'string') {
    const name = structured.error.class && !['ToolError', 'Cancelled'].includes(structured.error.class)
      ? `${structured.error.class}: `
      : ''

    return cut(`${name}${structured.error.message}`, keptError)
  }

  const text = answer && answer.content && answer.content[0] && answer.content[0].text

  return typeof text === 'string' ? cut(text, keptError) : null
}

/**
 * @param {Object|null} connection
 * @return {{id: String|null, name: String, tag: String}|null}
 */
const connectionOf = connection => (connection
  ? {
      id: typeof connection.id === 'string' ? connection.id : null,
      name: String(connection.name || connection.path || ''),
      tag: typeof connection.tag === 'string' ? connection.tag : 'local',
    }
  : null)

/**
 * The sessions that are kept, the newest first, by their file names: an id
 * starts with the moment it was made, so a name sorts the way the sessions
 * started.
 *
 * @param {String} dataDir
 * @return {Array<String>} the ids
 */
const ids = dataDir => {
  let names

  try {
    names = fs.readdirSync(directoryOf(dataDir))
  } catch (e) {
    return []
  }

  return names
    .filter(name => name.endsWith('.json'))
    .map(name => name.slice(0, -'.json'.length))
    .sort()
    .reverse()
}

/**
 * Forget the oldest sessions, so the journal holds no more than it keeps.
 *
 * @param {String} dataDir
 * @param {Number} keep
 */
const prune = (dataDir, keep) => {
  for (const id of ids(dataDir).slice(keep)) {
    fs.rmSync(fileOf(dataDir, id), {force: true})
  }
}

/**
 * The journal of one server process.
 *
 * Nothing is written until there is something to write: the handshake, or a
 * call from a client that skipped it. A server whose app data was not found
 * keeps no journal at all, because there is no app to show it.
 *
 * @param {{dataDir: String|null, version: String, target: Object,
 *   now?: Function, pid?: Number}} options `target` is what the server was
 *   started on, as target.resolve answered
 * @return {{begin: Function, record: Function, end: Function, now: Function,
 *   id: String}} `now` is the journal's clock, which a call is timed by
 */
const open = ({dataDir, version, target, now = Date.now, pid = process.pid}) => {
  const started = now()
  // the moment first, so a directory listing sorts by it; the rest so two
  // servers that start in the same millisecond are two sessions
  const id = `${started.toString(36).padStart(9, '0')}-${crypto.randomBytes(4).toString('hex')}`
  const session = {
    id,
    version,
    pid,
    started_at: started,
    updated_at: started,
    ended_at: null,
    client: null,
    protocol: null,
    target: Object.assign(connectionOf(target.connection), {saved: Boolean(target.saved)}),
    calls_total: 0,
    calls: [],
  }
  let written = false

  const write = () => {
    if (!dataDir) {
      return
    }

    session.updated_at = now()

    try {
      if (!written) {
        prune(dataDir, keptSessions - 1)
      }

      writeAtomic(fileOf(dataDir, id), JSON.stringify(session))
      written = true
    } catch (e) {
      // the journal is the app's view of the server, not the server's work: a
      // disk that refuses it does not get to fail a client's call
    }
  }

  /**
   * The handshake: who the client said it is.
   *
   * @param {{client?: Object, protocol?: String}} hello
   */
  const begin = ({client, protocol} = {}) => {
    session.client = client && typeof client.name === 'string'
      ? {name: cut(client.name, 200), version: typeof client.version === 'string' ? cut(client.version, 100) : null}
      : null
    session.protocol = typeof protocol === 'string' ? protocol : null

    write()
  }

  /**
   * One tool call, once it has answered.
   *
   * A run on a connection tagged production also keeps what the app's
   * production mode did to it: the mode that applied (`refuse`, `guarded` or
   * `allow`), whether that mode was the connection's own (`mode_source`), the
   * guard the run was actually sent with, and whether the mode forced that guard
   * instead of the call asking for it. The app's sessions list shows a forced
   * guard as forced, which is the one thing about a call there that a reader
   * cannot tell from the code.
   *
   * @param {{tool: String, args: Object, answer: Object, at: Number,
   *   connection?: Object|null, mode?: String|null, modeSource?: String|null,
   *   guard?: String|null, guardForced?: Boolean}} call
   */
  const record = ({
    tool,
    args = {},
    answer,
    at,
    connection = null,
    mode = null,
    modeSource = null,
    guard = undefined,
    guardForced = false,
  }) => {
    const entry = {
      tool,
      at,
      ms: Math.max(now() - at, 0),
      outcome: outcomeOf(tool, answer),
      connection: connectionOf(connection),
    }

    if (typeof args.code === 'string') {
      entry.code = cut(args.code, keptCode)

      if (args.code.length > keptCode) {
        entry.code_cut = true
      }
    }

    // the guard the run was sent with: a run tool reports its own, because a
    // forced one is not what the call asked for; anything else keeps what it
    // was given
    const sent = guard === undefined ? args.guard : guard

    if (typeof sent === 'string' && sent) {
      entry.guard = sent
    }

    if (guardForced) {
      entry.guard_forced = true
    }

    if (mode) {
      entry.mode = mode
    }

    if (mode && modeSource) {
      entry.mode_source = modeSource
    }

    if (entry.outcome === 'threw') {
      entry.error = errorOf(answer)
    }

    session.calls_total += 1
    session.calls.push(entry)

    if (session.calls.length > keptCalls) {
      session.calls.splice(0, session.calls.length - keptCalls)
    }

    write()
  }

  /**
   * The client closed the pipe, or the server was told to stop. A server that
   * wrote nothing writes nothing now either: a process that never heard from
   * a client is not a session anyone had.
   */
  const end = () => {
    if (!written || session.ended_at !== null) {
      return
    }

    session.ended_at = now()

    write()
  }

  return {id, begin, record, end, now}
}

/**
 * @param {Number} pid
 * @return {Boolean} whether a process with that id is running
 */
const running = pid => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)

    return true
  } catch (e) {
    // the process is there, it is only someone else's
    return e.code === 'EPERM'
  }
}

/**
 * A session as a list shows it: without its calls, with what they add up to.
 *
 * A session that never wrote its end is live while its process runs. Once the
 * process is gone it ended when it last wrote, because that is the last thing
 * anyone knows about it.
 *
 * @param {Object} session
 * @param {Function} alive
 * @return {Object}
 */
const summaryOf = (session, alive) => {
  const calls = Array.isArray(session.calls) ? session.calls : []
  const live = session.ended_at === null && alive(session.pid)

  return {
    id: session.id,
    version: session.version || null,
    client: session.client || null,
    target: session.target || null,
    started_at: session.started_at,
    ended_at: live ? null : (session.ended_at || session.updated_at || session.started_at),
    live,
    calls_total: Number(session.calls_total) || calls.length,
    threw: calls.filter(call => call.outcome === 'threw').length,
    runs: calls.filter(call => runTools.includes(call.tool)).length,
    connections: [...new Set(calls.map(call => call.connection && call.connection.name).filter(Boolean))],
  }
}

/**
 * @param {String} dataDir
 * @param {String} id
 * @param {Map} [cache] what was read before, by id: a file that has not changed
 * since is not read again, which is what lets a screen that is open ask often
 * @return {Object|null} the session as its file holds it, or nothing when it is
 * gone or cannot be read
 */
const readSession = (dataDir, id, cache = null) => {
  // an id is a file name the journal made, and nothing that walks out of the
  // directory it is in
  if (!/^[0-9a-z]+-[0-9a-f]+$/.test(String(id))) {
    return null
  }

  const file = fileOf(dataDir, id)

  try {
    const stat = fs.statSync(file)
    const stamp = `${stat.mtimeMs}:${stat.size}:${stat.ino}`
    const seen = cache && cache.get(id)

    if (seen && seen.stamp === stamp) {
      return seen.session
    }

    const read = readJson(file)
    const session = read && typeof read === 'object' && read.id === id ? read : null

    if (cache) {
      cache.set(id, {stamp, session})
    }

    return session
  } catch (e) {
    if (cache) {
      cache.delete(id)
    }

    return null
  }
}

/**
 * The sessions that are kept, newest first, as a list shows them.
 *
 * @param {String} dataDir
 * @param {{alive?: Function, cache?: Map}} [options]
 * @return {Array<Object>}
 */
const sessions = (dataDir, {alive = running, cache = null} = {}) => {
  const kept = ids(dataDir)

  if (cache) {
    for (const id of cache.keys()) {
      if (!kept.includes(id)) {
        cache.delete(id)
      }
    }
  }

  return kept
    .map(id => readSession(dataDir, id, cache))
    .filter(Boolean)
    .map(one => summaryOf(one, alive))
}

/**
 * One session in full: its summary and its calls, newest first.
 *
 * @param {String} dataDir
 * @param {String} id
 * @param {{alive?: Function}} [options]
 * @return {Object|null}
 */
const session = (dataDir, id, {alive = running} = {}) => {
  const stored = readSession(dataDir, id)

  if (!stored) {
    return null
  }

  const calls = Array.isArray(stored.calls) ? stored.calls.slice().reverse() : []

  return Object.assign(summaryOf(stored, alive), {calls})
}

/**
 * Forget the sessions that have ended. A live session stays: its process
 * writes the whole session again on its next call, and a list that was just
 * cleared would grow back a session with everything it held.
 *
 * @param {String} dataDir
 * @param {{alive?: Function}} [options]
 * @return {Array<Object>} what is left
 */
const clear = (dataDir, {alive = running} = {}) => {
  for (const summary of sessions(dataDir, {alive})) {
    if (!summary.live) {
      fs.rmSync(fileOf(dataDir, summary.id), {force: true})
    }
  }

  return sessions(dataDir, {alive})
}

module.exports = {
  keptSessions,
  keptCalls,
  keptCode,
  open,
  sessions,
  session,
  clear,
  outcomeOf,
}
