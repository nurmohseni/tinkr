const fs = require('fs')
const path = require('path')

const {phpString} = require('tinkr-core')

const {config} = require('../database/config')
const {exec, quoted} = require('../remote')

/**
 * The application's log files, as Laravel writes them.
 *
 * A log viewer is a window onto a file that is being appended to, and the viewer's
 * window is the one it opens on: the newest end of it — a hundred and twenty-eight
 * kilobytes is thousands of entries — read a window at a time from wherever the
 * reader asks, so that a file too big to hold is still read to the end. What is
 * shown is what those lines are: an entry per line that starts one, and everything
 * under it belonging to it.
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
 * How wide a window onto a log is: what was asked for, within what a viewer is
 * worth reading.
 *
 * @param {Number} [bytes]
 * @return {Number}
 */
const wantedOf = bytes => Math.min(Math.max(Number(bytes) || defaultBytes, 1024), maxBytes)

/**
 * Ask the machine a connection runs on a question in php, and answer with what
 * it said.
 *
 * A host that runs laravel is a host with php, which is the one thing the two
 * machines are known to have in common, and php reads no configuration to be
 * asked: one `php -r` per question is the whole of it. What comes back is the
 * answer itself, and nothing at all when the machine could not answer — an exit
 * that is not zero, or a silence — because a machine that does not answer is not
 * one holding an empty answer.
 *
 * @param {Record<String, any>} connection
 * @param {String} code the php to run, without its opening tag
 * @return {Promise<String|null>}
 */
const ask = async (connection, code) => {
  const answer = await exec(connection, `php -r ${quoted(code)}`)

  return answer.code === 0 ? answer.stdout : null
}

/**
 * The log files of a connection whose project lives on another machine.
 *
 * The listing is asked of that machine: one line per file, the name, the size,
 * and when it was written last. The bytes are the only thing that crosses, and
 * the shape the picker reads is made here, out of the same parts the local
 * listing is made of.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<Object>} `files`, and `dir` for the panel to say where it looked
 */
const sshFiles = async connection => {
  const dir = dirOf(connection)

  const listing = await ask(
    connection,
    '$tinkr_dir=' + phpString(dir) + ';' +
    "foreach(glob($tinkr_dir.'/*.log') as $tinkr_file){" +
    'echo basename($tinkr_file),"\\t",filesize($tinkr_file),"\\t",(int)round(filemtime($tinkr_file)*1000),"\\n";' +
    '}',
  )

  // a project that keeps no logs there, and one that could not be asked, are the
  // same thing to a picker: there are none
  if (!listing) {
    return {dir, files: []}
  }

  const found = listing
    .split('\n')
    .filter(line => line !== '')
    .map(line => {
      const [name, size, at] = line.split('\t')

      return {name, size: Number(size), at: Number(at)}
    })

  found.sort((one, other) => other.at - one.at)

  return {dir, files: found}
}

/**
 * The log files of a connection, newest first, as the viewer's picker lists them.
 *
 * A project on this machine has them here and is read from here; a project on
 * another one has them there, so they are asked of that machine and come back as
 * the same answer.
 *
 * @param {Record<String, any>} connection
 * @return {Object|Promise<Object>} `files`, and `dir` for the panel to say where it looked
 */
const files = connection => {
  if (connection && connection.is_over_ssh) {
    return sshFiles(connection)
  }

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
 * Where a window onto a log ends, in bytes.
 *
 * The end of the file is the one place a reader cannot name in advance, because
 * only the file knows it, so a window that was not told where to stop stops there.
 *
 * @param {Number} [before] the offset the window ends at
 * @param {Number} size how much there is
 * @return {Number}
 */
const endOf = (before, size) => before == null ? size : Math.min(Math.max(Number(before) || 0, 0), size)

/**
 * What a window onto a log is, out of the bytes of it.
 *
 * A window starts wherever it starts: the first line of one that does not start at
 * the beginning of the file is the rest of a line that was not read, so it is
 * dropped rather than shown as a mangled entry.
 *
 * @param {String} file the name of the log
 * @param {Number} size how much the file holds
 * @param {Number} from the offset the window starts at
 * @param {Number} to the offset it ends at
 * @param {String} text the bytes in between
 * @return {Object} the entries of the window, and where it sits in the file
 */
const windowOf = (file, size, from, to, text) => {
  const lines = text.split('\n')

  if (from > 0) {
    lines.shift()
  }

  return {
    file,
    size,
    read: to - from,
    from,
    // the file is being written to, so the last line of it may be half written
    entries: parse(lines.filter(line => line !== '')),
  }
}

/**
 * The window onto one of a connection's log files that lives on another machine.
 *
 * The same window the local read takes, asked for: the size of the file and the
 * bytes of it as json, because the bytes are what crosses and what they mean is
 * what this side reads them as.
 *
 * @param {Record<String, any>} connection
 * @param {String} name a file in the connection's log directory, by name
 * @param {Object} [options] `bytes` for how wide the window is, `before` for where it ends
 * @return {Promise<Object>} `text`, `entries`, and what was read of what there is
 */
const sshRead = async (connection, name, {bytes, before} = {}) => {
  const file = path.join(dirOf(connection), name)
  const wanted = wantedOf(bytes)
  // where the end of the file is is what the other machine knows and this one does
  // not, so a window that ends there is the one thing the php is told to work out
  const ends = before == null ? '$tinkr_size' : String(Math.max(Number(before) || 0, 0))

  const answer = await ask(
    connection,
    '$tinkr_file=' + phpString(file) + ';' +
    '$tinkr_size=@filesize($tinkr_file);' +
    'if($tinkr_size===false){exit(1);}' +
    '$tinkr_to=min(' + ends + ',$tinkr_size);' +
    '$tinkr_from=max($tinkr_to-' + wanted + ',0);' +
    "$tinkr_handle=fopen($tinkr_file,'r');" +
    'fseek($tinkr_handle,$tinkr_from);' +
    "echo json_encode(['size'=>$tinkr_size,'text'=>stream_get_contents($tinkr_handle,$tinkr_to-$tinkr_from)],JSON_INVALID_UTF8_SUBSTITUTE);",
  )

  let described = null

  try {
    described = JSON.parse(answer)
  } catch (e) {
    // an answer that is not the size of a file and the bytes of it is no answer,
    // which is what a machine that cannot say has said
    described = null
  }

  if (!described || typeof described.size !== 'number') {
    throw new Error(`${name} is not there any more.`)
  }

  const size = Number(described.size)
  const to = endOf(before, size)
  const from = Math.max(to - wanted, 0)

  return windowOf(name, size, from, to, String(described.text))
}

/**
 * A window onto one of a connection's log files.
 *
 * A project on this machine has its file here and is read from here, in this
 * process; a project on another one has it there, and only the bytes of the window
 * come back. Either way the file is never held: what is held is the window the
 * caller asked for, which is why a log of forty megabytes costs what a log of a
 * hundred kilobytes does.
 *
 * @param {Record<String, any>} connection
 * @param {String} name a file in the connection's log directory, by name
 * @param {Object} [options] `bytes` for how wide the window is, `before` for where it ends
 * @return {Object|Promise<Object>} `text`, `entries`, and what was read of what there is
 */
const read = (connection, name, {bytes, before} = {}) => {
  // the name comes from a window, and a window has no business naming a path
  if (name !== path.basename(name) || !name.endsWith('.log')) {
    throw new Error(`${name} is not a log file of this connection.`)
  }

  if (connection && connection.is_over_ssh) {
    return sshRead(connection, name, {bytes, before})
  }

  const file = path.join(dirOf(connection), name)
  const wanted = wantedOf(bytes)

  let size

  try {
    size = fs.statSync(file).size
  } catch (e) {
    throw new Error(`${name} is not there any more.`)
  }

  const to = endOf(before, size)
  const from = Math.max(to - wanted, 0)
  const descriptor = fs.openSync(file, 'r')

  let text = ''

  try {
    const buffer = Buffer.alloc(to - from)

    fs.readSync(descriptor, buffer, 0, buffer.length, from)
    text = buffer.toString('utf8')
  } finally {
    fs.closeSync(descriptor)
  }

  return windowOf(name, size, from, to, text)
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
