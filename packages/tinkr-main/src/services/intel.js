const fs = require('fs')
const path = require('path')
const {createHash} = require('crypto')
const {gzipSync, gunzipSync} = require('zlib')

const {
  connectionKind,
  isApiRun,
  intelCode,
  classCode,
  membersOf,
} = require('tinkr-core')

const {ask} = require('./php')
const {dataDir} = require('../utils/dataDir')

/**
 * What a project holds, read once so that nothing typed has to read it.
 *
 * The editor answers a keystroke from memory: the members of a model, the root a
 * facade forwards to, the keys of a config file. None of that can be asked of the
 * connection at a keystroke — a keystroke is no moment to boot an app on another
 * machine — so it is read here, whole, as json, by one program run in the
 * project's directory: the app boots, and the program asks it what classes,
 * models, facades, config keys, routes, views and names it declares (see
 * intelScript in tinkr-core). The read is kept in memory and on disk, and a
 * keystroke reads what is there.
 *
 * A read is refreshed by a run, the same way a project's index is: a run can
 * create a class, migrate a table, write a config key, and what the editor offers
 * is read again afterwards (see createPty). Nothing waits on it.
 *
 * The program travels gzipped and base64'd inside one `php -r`: 20 KB of php as a
 * bare command line is past what a windows shell accepts, and the packed program
 * is a third of that (see runner below).
 */

// how long a read may take. Boot of a project's app is a fraction of a second,
// and this is the most a cold machine on a slow link is given before what it
// knows is "not known" rather than a popup that waits
const budget = 8000

// what an answer may be before it is not one to keep: the members of a project's
// app are a few megabytes of json, and nothing larger is read here
const answerLimit = 4 * 1024 * 1024

// how many lazily read classes one connection's memory holds. A snippet's own
// classes are in the read already; this is for the framework's, and a handful of
// them is what a session touches
const keptClasses = 64

// how long a class that could not be read is remembered as unreadable, so that a
// keystroke is not a question to a machine that already did not answer it
const retryFailed = 5 * 60 * 1000

// what a php built without the compression extension prints instead of an answer
const marker = 'tinkr-no-zlib'

// the reads, and the classes read for them, by connection
const reads = new Map()
const pending = new Map()
const failures = new Map()
const classes = new Map()
const classReads = new Map()

// the packed program of a source, by source: gzipping 20 KB of php at every
// refresh is work with one answer
const packedPrograms = new Map()

/**
 * What a connection reads, as a key: two connections to the same project share a
 * read, because they would answer the same questions with the same bytes.
 *
 * @param {Record<String, any>} connection
 * @return {String}
 */
const keyOf = connection => {
  const parts = [
    connectionKind(connection),
    (connection && connection.path) || '',
    (connection && connection.host) || '',
    (connection && connection.user) || '',
    (connection && connection.container_name) || '',
  ]

  return createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 20)
}

/**
 * The connection a read runs on.
 *
 * A connection whose code runs through an API has no machine here to ask, and the
 * only project it has on this one is the checkout it names: that is what is read,
 * or nothing at all. Nothing is sent to the API for a popup — a read there would
 * be a command in the environment's history, on production, for a suggestion.
 *
 * @param {Record<String, any>} connection
 * @return {Record<String, any>|null}
 */
const localOf = connection => {
  if (!isApiRun(connection)) {
    return connection || null
  }

  if (!connection || !connection.path) {
    return null
  }

  return Object.assign({}, connection, {
    is_cloud: false,
    is_vapor: false,
    is_over_ssh: false,
    container_engine: '',
    container_name: '',
  })
}

/**
 * The file a read is kept in, or null when the app has no directory of its own to
 * keep it in (a test).
 *
 * @param {String} key
 * @return {String|null}
 */
const cacheFile = key => {
  const dir = dataDir()

  return dir ? path.join(dir, 'intel', key + '.json.gz') : null
}

/**
 * The read kept on disk, as it was left.
 *
 * @param {String} key
 * @return {{intel: Object, at: Number}|null}
 */
const readDisk = key => {
  const file = cacheFile(key)

  if (!file) {
    return null
  }

  try {
    const held = JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8'))

    if (!held || !held.intel || typeof held.intel !== 'object') {
      return null
    }

    return {intel: held.intel, at: Number(held.at) || 0}
  } catch (e) {
    // a file that cannot be read is a cache that is not there, not a read that
    // failed: it is written again by the next read
    return null
  }
}

/**
 * Keep the read for the next process to start.
 *
 * @param {String} key
 * @param {{intel: Object, at: Number}} entry
 */
const writeDisk = (key, entry) => {
  const file = cacheFile(key)

  if (!file) {
    return
  }

  fs.promises.mkdir(path.dirname(file), {recursive: true, mode: 0o700})
    .then(() => fs.promises.writeFile(file, gzipSync(Buffer.from(JSON.stringify(entry)))))
    .catch(() => {})
}

/**
 * The program, packed, as the php that unpacks and runs it.
 *
 * @param {String} program
 * @return {String}
 */
const packedOf = program => {
  let packed = packedPrograms.get(program)

  if (packed === undefined) {
    packed = gzipSync(Buffer.from(program, 'utf8')).toString('base64')

    // the three programs a session runs are all it runs, and the map keeps the
    // packed form of each of them
    if (packedPrograms.size >= 8) {
      packedPrograms.clear()
    }

    packedPrograms.set(program, packed)
  }

  return packed
}

/**
 * The `php -r` code that runs a packed program.
 *
 * @param {String} payload the program's bytes, base64'd
 * @return {String}
 */
const runner = payload =>
  'error_reporting(0);' +
  // a warning the program causes is not part of its answer, and json is read
  // whole or not at all
  "ini_set('display_errors','stderr');" +
  "$tinkr_payload=base64_decode('" + payload + "');" +
  'if(strncmp($tinkr_payload,"\\x1f\\x8b",2)===0){' +
  // a php without zlib cannot unpack the program, and says which one it is
  // instead of dying in the middle of an answer
  "if(!function_exists('gzdecode')){echo '" + marker + "';exit(0);}" +
  '$tinkr_payload=gzdecode($tinkr_payload);}' +
  // the program is php code, so it is run the way `include` would run it: out of
  // php mode, then back into it, with the program's own `<?php` opening it
  "eval('?>'.$tinkr_payload);"

/**
 * An answer, when it is the json it is read as.
 *
 * @param {String|null} answer
 * @return {Object|Array|null}
 */
const jsonOf = answer => {
  if (typeof answer !== 'string') {
    return null
  }

  const trimmed = answer.trim()

  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed)

    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (e) {
    // an answer that is not json is not an answer: a machine that printed a
    // warning over it, or something else entirely, is one to ask again rather
    // than one holding an empty project
    return null
  }
}

/**
 * Run a program on the connection's machine, and answer with its json.
 *
 * @param {Record<String, any>} connection
 * @param {String} program
 * @param {{maxBuffer: Number, timeout: Number}} limits
 * @return {Promise<Object|Array|null>}
 */
const readProgram = async (connection, program, limits) => {
  const answer = await ask(connection, runner(packedOf(program)), limits)

  if (answer !== null && answer.trim() === marker) {
    // a php without zlib still runs the program: it travels unpacked. It is the
    // one read that may be too long for a windows command line, and it is a
    // machine that has already answered that it cannot do it the short way
    return jsonOf(await ask(connection, runner(Buffer.from(program, 'utf8').toString('base64')), limits))
  }

  return jsonOf(answer)
}

/**
 * What a read says a project holds, by count, for the status of the read.
 *
 * @param {Object|null} intel
 * @return {Object|null}
 */
const countsOf = intel => {
  if (!intel || typeof intel !== 'object') {
    return null
  }

  const size = value => {
    if (Array.isArray(value)) {
      return value.length
    }

    return value && typeof value === 'object' ? Object.keys(value).length : 0
  }

  return {
    models: size(intel.models),
    classes: size(intel.classes),
    facades: size(intel.facades),
    config: size(intel.config),
    routes: size(intel.routes),
    views: size(intel.views),
    functions: size(intel.functions),
    constants: size(intel.constants),
    bindings: size(intel.bindings),
  }
}

/**
 * The read a connection already has, if it has one: from memory, which is the
 * whole of what a keystroke may cost, or from the copy the last process left.
 *
 * @param {Record<String, any>} connection
 * @return {Object|null}
 */
const readyIntel = connection => {
  if (!localOf(connection)) {
    return null
  }

  const key = keyOf(connection)

  // a project that has been looked for and holds nothing is looked for once
  if (!reads.has(key)) {
    reads.set(key, readDisk(key) || {intel: null, at: 0})
  }

  const held = reads.get(key)

  return held ? held.intel : null
}

/**
 * Read a connection's project now, and keep what it holds.
 *
 * A read that fails keeps the read before it, and answers with it: what a project
 * held a minute ago is worth more than nothing, and a popup that empties because
 * a machine is slow is a popup that lies about the project. What fails is
 * remembered, so that the keystroke after it is not another read.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<Object|null>}
 */
const refreshIntel = connection => {
  const local = localOf(connection)

  if (!local) {
    return Promise.resolve(null)
  }

  const key = keyOf(connection)
  const running = pending.get(key)

  if (running) {
    return running
  }

  const read = (async () => {
    const answer = await readProgram(local, intelCode(), {maxBuffer: answerLimit, timeout: budget})

    if (!answer || typeof answer !== 'object' || Array.isArray(answer) || answer.version === undefined) {
      failures.set(key, {at: Date.now(), error: 'the project did not answer'})

      const held = reads.get(key)

      return held ? held.intel : null
    }

    const entry = {intel: answer, at: Date.now()}

    reads.set(key, entry)
    failures.delete(key)
    writeDisk(key, entry)

    return answer
  })().catch(error => {
    failures.set(key, {at: Date.now(), error: error && error.message ? error.message : String(error)})

    const held = reads.get(key)

    return held ? held.intel : null
  }).finally(() => {
    pending.delete(key)
  })

  pending.set(key, read)

  return read
}

/**
 * How long a change on disk waits before the project is read again: an editor
 * saving a file is one change, a formatter writing six is six, and a read of the
 * project is not worth six of itself.
 */
const watchDelay = 1200

// the directories a read is made from, and the file that says what is installed
const watchDirs = ['app', 'routes', 'config', 'database', 'lang']

// the watchers, one set per connection, by the key of what they watch
const watchers = new Map()

/**
 * Whether a change on disk is one the read would say something about: php code,
 * and what the project installed. A run that writes its sqlite file is not news
 * to a list of models.
 *
 * @param {String|null} filename
 * @return {Boolean}
 */
const isWatched = filename => !filename || /\.(php|json)$/i.test(String(filename)) || /composer\.lock$/i.test(String(filename))

/**
 * Read the project again, once the changes have settled.
 *
 * The read is the same one prefetchIntel starts: it is kept and answers the next
 * keystroke, and it is never something a keystroke waits on.
 *
 * @param {String} key
 * @param {Record<String, any>} connection
 */
const readSoon = (key, connection) => {
  const held = watchers.get(key)

  if (!held) {
    return
  }

  clearTimeout(held.timer)
  held.timer = setTimeout(() => {
    held.timer = null

    refreshIntel(connection).catch(() => {})
  }, watchDelay)

  // a timer is not a reason for the process to stay up
  if (held.timer && typeof held.timer.unref === 'function') {
    held.timer.unref()
  }
}

/**
 * Follow a connection's project, and read it again when it changes.
 *
 * Only a project on this machine is followed: a read of an ssh or an API
 * connection runs somewhere else, and a watcher here would be watching nothing a
 * change could reach. `composer.lock` is watched where it sits.
 *
 * @param {Record<String, any>} connection
 */
const watchIntel = connection => {
  const local = localOf(connection)
  const root = local && local.path

  if (!root) {
    return
  }

  const key = keyOf(connection)

  if (watchers.has(key)) {
    return
  }

  const held = {handles: [], timer: null}

  const onChange = (event, filename) => {
    if (isWatched(filename)) {
      readSoon(key, connection)
    }
  }

  const follow = target => {
    let stats

    try {
      stats = fs.statSync(target)
    } catch (e) {
      return
    }

    try {
      // a directory is followed whole, so a class added under it is a change like
      // any other; a file is followed where it is
      const handle = fs.watch(target, {recursive: stats.isDirectory(), persistent: false}, onChange)

      // a directory that is removed under the watcher is a project that moved: the
      // next prefetch follows it where it is
      handle.on('error', () => {
        try {
          handle.close()
        } catch (e) {
          // the watcher's own teardown, which has nothing left to fail at
        }

        watchers.delete(key)
      })

      held.handles.push(handle)
    } catch (e) {
      // a project without the directory, or one this process may not read: there
      // is nothing to follow, and nothing to say about it
    }
  }

  for (const dir of watchDirs) {
    follow(path.join(root, dir))
  }

  follow(path.join(root, 'composer.lock'))

  if (held.handles.length) {
    watchers.set(key, held)
  }
}

/**
 * Stop following a project, and forget the read that is waiting on it.
 *
 * @param {Record<String, any>|String} connectionOrKey
 */
const unwatchIntel = connectionOrKey => {
  const key = typeof connectionOrKey === 'string' ? connectionOrKey : keyOf(connectionOrKey)
  const held = watchers.get(key)

  if (!held) {
    return
  }

  clearTimeout(held.timer)

  for (const handle of held.handles) {
    try {
      handle.close()
    } catch (e) {
      // already closed
    }
  }

  watchers.delete(key)
}

/**
 * The read a project is given when a window opens on it, or the one already in
 * flight: one read per connection, whichever window asks.
 *
 * A caller that wants to wait for it — the first keystroke of a window, which is
 * owed members rather than "No suggestions." — is answered with the read itself.
 * Nothing else is written here: a machine that did not answer a read a moment ago
 * is not asked again, and that is still a null.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<Object|null>|null} the read, or null when there is none to wait
 * for
 */
const prefetchIntel = connection => {
  if (!localOf(connection)) {
    return null
  }

  watchIntel(connection)

  if (readyIntel(connection)) {
    return null
  }

  // a machine that did not answer a read a moment ago is not asked again by the
  // next window opened on it
  const failed = failures.get(keyOf(connection))

  if (failed && Date.now() - failed.at < retryFailed) {
    return null
  }

  return refreshIntel(connection)
}

/**
 * How the read of a connection stands: what the editor can say about it, and
 * what it was read from.
 *
 * @param {Record<String, any>} connection
 * @return {{state: String, at: Number|null, counts: Object|null, error?: String}}
 */
const intelStatus = connection => {
  if (!localOf(connection)) {
    return {state: 'none', at: null, counts: null}
  }

  const key = keyOf(connection)

  if (pending.has(key)) {
    return {state: 'reading', at: null, counts: null}
  }

  const intel = readyIntel(connection)
  const held = reads.get(key)

  if (intel) {
    return {state: 'ready', at: (held && held.at) || null, counts: countsOf(intel)}
  }

  const failed = failures.get(key)

  if (failed) {
    return {state: 'failed', at: failed.at, counts: null, error: failed.error}
  }

  return {state: 'none', at: null, counts: null}
}

/**
 * One connection's lazily read classes, by name.
 *
 * @param {String} key
 * @return {Map<String, {at: Number, entry: Object|null}>}
 */
const classTable = key => {
  let table = classes.get(key)

  if (!table) {
    table = new Map()
    classes.set(key, table)
  }

  return table
}

/**
 * A class that has already been read, or null — including one that was asked
 * about and was not there.
 *
 * @param {String} key
 * @param {String} name
 * @return {Object|null}
 */
const cachedClass = (key, name) => {
  const held = classTable(key).get(String(name).toLowerCase())

  return held ? held.entry : null
}

/**
 * Whether a class is still to be asked about: one never read, or one that could
 * not be read long enough ago that the file may exist by now.
 *
 * @param {String} key
 * @param {String} name
 * @return {Boolean}
 */
const unreadClass = (key, name) => {
  const held = classTable(key).get(String(name).toLowerCase())

  if (!held) {
    return true
  }

  return !held.entry && Date.now() - held.at > retryFailed
}

/**
 * The members of a class the read did not carry, asked of the machine once.
 *
 * @param {Record<String, any>} connection
 * @param {String} key
 * @param {String} name
 * @return {Promise<Object|null>}
 */
const readClass = (connection, key, name) => {
  const id = key + '\u0000' + name
  const running = classReads.get(id)

  if (running) {
    return running
  }

  const read = (async () => {
    const answer = await readProgram(connection, classCode(name), {maxBuffer: answerLimit, timeout: budget})
    const entry = answer && answer.exists === true ? answer : null
    const table = classTable(key)

    table.set(String(name).toLowerCase(), {at: Date.now(), entry})

    // the table is a cache of what a session touched, and a session touches a
    // handful of the framework's classes
    while (table.size > keptClasses) {
      table.delete(table.keys().next().value)
    }

    return entry
  })().catch(() => null).finally(() => {
    classReads.delete(id)
  })

  classReads.set(id, read)

  return read
}

/**
 * The members of a name, read if the project's own read does not carry the class.
 *
 * The read holds the project's models, the model and collection base classes, and
 * the two builders — which is what a snippet is mostly about. A framework class
 * the read did not carry (`Str`, a facade's manager, the model a relation points
 * at) is read once, on the machine, when something is asked about it, and kept
 * for the session: a keystroke after that one costs nothing.
 *
 * @param {Record<String, any>} connection
 * @param {String|null} fqcn
 * @param {{static?: Boolean, item?: String}} [options]
 * @return {Promise<Array<Object>>}
 */
const membersFor = async (connection, fqcn, options = {}) => {
  if (!localOf(connection) || !fqcn) {
    return []
  }

  const intel = readyIntel(connection)

  if (!intel) {
    return []
  }

  const key = keyOf(connection)
  const wanted = new Set()
  const fetch = name => {
    wanted.add(name)

    return cachedClass(key, name)
  }
  const asked = {static: options.static === true, item: options.item || null, fetch}
  let members = membersOf(intel, fqcn, asked)

  // what the first answer needed and did not have is read, and the answer is
  // asked for again: a facade's manager and a mixin are two names deep, and both
  // arrive at once
  const missing = [...wanted].filter(name => unreadClass(key, name))

  if (missing.length) {
    await Promise.all(missing.slice(0, 2).map(name => readClass(connection, key, name)))

    members = membersOf(intel, fqcn, asked)
  }

  return members
}

/**
 * The same members, from what has already been read: nothing is asked of the
 * machine, so a caller that cannot wait has an answer or an empty list.
 *
 * @param {Record<String, any>} connection
 * @param {String|null} fqcn
 * @param {{static?: Boolean, item?: String}} [options]
 * @return {Array<Object>}
 */
const readyMembers = (connection, fqcn, options = {}) => {
  if (!localOf(connection) || !fqcn) {
    return []
  }

  const intel = readyIntel(connection)

  if (!intel) {
    return []
  }

  const key = keyOf(connection)

  return membersOf(intel, fqcn, {
    static: options.static === true,
    item: options.item || null,
    fetch: name => cachedClass(key, name),
  })
}

module.exports = {
  prefetchIntel,
  refreshIntel,
  readyIntel,
  intelStatus,
  membersFor,
  readyMembers,
  watchIntel,
  unwatchIntel,
}
