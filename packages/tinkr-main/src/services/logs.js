const fs = require('fs')
const path = require('path')

const {config} = require('../database/config')

/**
 * The application's log files, as Laravel writes them.
 *
 * A log viewer is a window onto the newest end of a file that is being appended
 * to, so what is read is the tail of it — a hundred and twenty-eight kilobytes is
 * thousands of entries — and what is shown is what those lines are: an entry per
 * line that starts one, and everything under it belonging to it.
 *
 * Laravel writes each entry as monolog's line formatter does:
 *
 *   [2026-08-27 11:10:53] testing.ERROR: No certificate found {"exception":"…"}
 *   [stacktrace]
 *   #0 /app/Models/Abonado.php(1905): …
 *
 * The context runs to the end of the line and often over the following ones, and
 * it is json written by a formatter rather than a document: it is kept whole as
 * the entry's details rather than parsed, because the message is what a person
 * reads and the details are what they open.
 */

// what the viewer reads unless it is asked for more, and the most it will read
const defaultBytes = 128 * 1024
const maxBytes = 2 * 1024 * 1024

// the header of an entry: `[when] environment.LEVEL: what it says`
const header = /^\[([^\]]+)\]\s+([^.\s]+)\.([A-Z]+):\s?([\s\S]*)$/

// the levels monolog knows, which is what a filter offers
const levels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']

/**
 * Where a connection's log files are.
 *
 * `storage/logs` is where Laravel puts them; a project that keeps its own
 * somewhere else says so in the preferences, relative to the project.
 *
 * @param {Record<String, any>} connection
 * @return {String}
 */
const dirOf = connection => path.join(connection.path || '', config.get('log_dir', '') || 'storage/logs')

/**
 * The log files of a connection, newest first, as the viewer's picker lists them.
 *
 * @param {Record<String, any>} connection
 * @return {Object} `files`, and `dir` for the panel to say where it looked
 */
const files = connection => {
  const dir = dirOf(connection)

  let names = []

  try {
    names = fs.readdirSync(dir)
  } catch (e) {
    // a project without a log directory is one whose logs are not here
    return {dir, files: []}
  }

  let stat

  const found = names
    .filter(name => name.endsWith('.log'))
    .map(name => {
      try {
        stat = fs.statSync(path.join(dir, name))
      } catch (e) {
        return null
      }

      return {name, size: stat.size, at: stat.mtimeMs}
    })
    .filter(Boolean)

  found.sort((one, other) => other.at - one.at)

  return {dir, files: found}
}

/**
 * What the lines of a log are: one entry per line that starts one, and what
 * follows it.
 *
 * A line that starts nothing belongs to the entry above it — a stack trace, the
 * rest of a json context — and a line that starts nothing and has no entry above
 * it is shown as it is, because it is in the file and hiding it would be lying
 * about what the file holds.
 *
 * @param {Array<String>} lines
 * @return {Array<Object>}
 */
const parse = lines => {
  const entries = []

  for (const line of lines) {
    const found = header.exec(line)

    if (!found) {
      if (entries.length === 0) {
        entries.push({at: null, environment: null, level: null, message: line, details: ''})

        continue
      }

      const last = entries[entries.length - 1]

      last.details = last.details === '' ? line : `${last.details}\n${line}`

      continue
    }

    const [, at, environment, level, rest] = found
    // the json context a formatter appended starts at the first ` {` after the
    // message; everything from there is the entry's details
    const context = rest.search(/\s\{/)

    entries.push({
      at,
      environment,
      level: level.toLowerCase(),
      message: context === -1 ? rest : rest.slice(0, context),
      details: context === -1 ? '' : rest.slice(context + 1),
    })
  }

  return entries
}

/**
 * The tail of one of a connection's log files.
 *
 * @param {Record<String, any>} connection
 * @param {String} name a file in the connection's log directory, by name
 * @param {Number} [bytes] how much of the end of it to read
 * @return {Object} `text`, `entries`, and what was read of what there is
 */
const read = (connection, name, bytes = defaultBytes) => {
  // the name comes from a window, and a window has no business naming a path
  if (name !== path.basename(name) || !name.endsWith('.log')) {
    throw new Error(`${name} is not a log file of this connection.`)
  }

  const file = path.join(dirOf(connection), name)
  const wanted = Math.min(Math.max(Number(bytes) || defaultBytes, 1024), maxBytes)

  let size

  try {
    size = fs.statSync(file).size
  } catch (e) {
    throw new Error(`${name} is not there any more.`)
  }

  const from = Math.max(size - wanted, 0)
  const descriptor = fs.openSync(file, 'r')

  let text = ''

  try {
    const buffer = Buffer.alloc(size - from)

    fs.readSync(descriptor, buffer, 0, buffer.length, from)
    text = buffer.toString('utf8')
  } finally {
    fs.closeSync(descriptor)
  }

  // a tail starts wherever it starts: the first line of it is the rest of a line
  // that was not read, so it is dropped rather than shown as a mangled entry
  const lines = text.split('\n')

  if (from > 0) {
    lines.shift()
  }

  return {
    file: name,
    size,
    read: size - from,
    // the file is being written to, so the last line of it may be half written
    entries: parse(lines.filter(line => line !== '')),
  }
}

module.exports = {
  defaultBytes,
  maxBytes,
  levels,
  dirOf,
  files,
  parse,
  read,
}
