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

// monolog's json formatter writes one object per line and no header at all:
// `{"message":"…","context":{…},"level":400,"level_name":"ERROR","channel":"local","datetime":"…"}`.
// Read as ordinary lines it is one headerless entry whose details are the rest
// of the file, so its level can never be filtered on
const jsonLine = /^\s*\{.*"level_name"\s*:.*\}\s*$/

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
    const asJson = jsonEntry(line)

    if (asJson) {
      entries.push(asJson)

      continue
    }

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
 * One line of monolog's json formatter, as an entry.
 *
 * The fields are the formatter's own: `message`, `context` and `extra` are what
 * the call wrote, `level_name` is the level as a word, and `datetime` is when.
 * Everything but the message and the level is the entry's details, shown as the
 * json it arrived as — that is what it was.
 *
 * A line that looks like json and does not parse is not one: it falls through to
 * the ordinary reading, where it is a line of whatever entry it follows.
 *
 * @param {String} line
 * @return {Object|null}
 */
const jsonEntry = line => {
  if (!jsonLine.test(line)) {
    return null
  }

  let value

  try {
    value = JSON.parse(line)
  } catch (e) {
    return null
  }

  if (!value || typeof value !== 'object' || typeof value.level_name !== 'string') {
    return null
  }

  const context = Object.assign({}, value)
  const message = typeof value.message === 'string' ? value.message : ''

  delete context.message
  delete context.level_name
  delete context.datetime
  delete context.channel

  return {
    at: typeof value.datetime === 'string' ? value.datetime : null,
    environment: typeof value.channel === 'string' ? value.channel : null,
    level: value.level_name.toLowerCase(),
    message,
    details: Object.keys(context).length ? JSON.stringify(context, null, 2) : '',
  }
}

// the json formatter's own stamp, taken from the text rather than by parsing the
// line: seeking reads every line of a file, and parsing each one to read a date
// is work the date itself does not need
const jsonAt = /"datetime"\s*:\s*"([^"]+)"/

/**
 * When a line of a log was written, in the shape a range is given.
 *
 * Both of monolog's formatters are read, because both turn up in files people
 * point this viewer at: the header's own stamp, which is already `2026-08-27
 * 11:10:52`, and the json formatter's `datetime`, which is the same moment
 * written with a `T`, a fraction and an offset. Reducing the second to the shape
 * of the first is what makes a range comparable across both, and the shape is
 * deliberately the kind that sorts as text, so a range is a comparison rather
 * than a parse.
 *
 * @param {String} line
 * @return {String|null}
 */
const stampOf = line => {
  const found = header.exec(line)

  if (found) {
    return found[1].trim().slice(0, 19)
  }

  // only a line that is actually the formatter's object carries its stamp: the
  // same words inside an ordinary message are the message
  if (!jsonLine.test(line)) {
    return null
  }

  const written = jsonAt.exec(line)

  // `2026-08-27T11:10:52.000000+00:00` is the moment `2026-08-27 11:10:52` was
  return written ? written[1].replace('T', ' ').slice(0, 19) : null
}

/**
 * Where the lines a range names begin, in bytes, in a file on this machine.
 *
 * A range is found by reading the file, not by filtering the window that happens
 * to be in view: a window holds the last 128 KB of a file that may be forty
 * megabytes, so asking it for last Tuesday would answer "nothing" about entries
 * that are plainly there. The scan reads whole lines out of byte chunks -- a
 * newline is one byte and no byte of a multi-byte character can be one -- so it
 * costs what the file costs and holds no more than a chunk and the line in hand.
 *
 * `after` decides which side of the range is wanted: the first line at or past
 * the stamp, or the first one strictly past it, which is where a range ends.
 *
 * @param {String} file a path
 * @param {String} stamp a moment in the shape stampOf returns
 * @param {Boolean} [after] whether the line has to be past the stamp, not at it
 * @return {Number} the offset, or the size of the file when no line answers
 */
const seekLocal = (file, stamp, after = false) => {
  const descriptor = fs.openSync(file, 'r')

  const chunk = 64 * 1024
  const answers = at => at !== null && (after ? at > stamp : at >= stamp)
  let rest = Buffer.alloc(0)
  let restAt = 0
  let readAt = 0
  let size = 0

  try {
    size = fs.fstatSync(descriptor).size

    while (readAt < size) {
      const piece = Buffer.alloc(Math.min(chunk, size - readAt))

      fs.readSync(descriptor, piece, 0, piece.length, readAt)

      readAt += piece.length

      let data = rest.length === 0 ? piece : Buffer.concat([rest, piece])
      let lineAt = restAt
      let end = data.indexOf(10)

      while (end !== -1) {
        if (answers(stampOf(data.slice(0, end).toString('utf8')))) {
          return lineAt
        }

        data = data.slice(end + 1)
        lineAt += end + 1
        end = data.indexOf(10)
      }

      rest = data
      restAt = lineAt
    }

    // a file whose last line has no newline after it still has that line
    if (rest.length > 0 && answers(stampOf(rest.toString('utf8')))) {
      return restAt
    }
  } finally {
    fs.closeSync(descriptor)
  }

  return size
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
 * a line's own beginning is the rest of a line that was not read, so it is dropped
 * rather than shown as a mangled entry. `whole` says the window does begin a line,
 * which a window taken from the start of a range does, and then nothing is lost.
 *
 * @param {String} file the name of the log
 * @param {Number} size how much the file holds
 * @param {Number} from the offset the window starts at
 * @param {Number} to the offset it ends at
 * @param {String} text the bytes in between
 * @param {Object} [range] `from` and `to` of the range it was read inside
 * @param {Boolean} [whole] whether the window begins a line
 * @return {Object} the entries of the window, and where it sits in the file
 */
const windowOf = (file, size, from, to, text, range, whole = false) => {
  const lines = text.split('\n')

  if (from > 0 && !whole) {
    lines.shift()
  }

  return {
    file,
    size,
    read: to - from,
    from,
    // the range the window was read inside, which is where paging stops
    range: range || {from: 0, to: size},
    // the file is being written to, so the last line of it may be half written
    entries: parse(lines.filter(line => line !== '')),
  }
}

/**
 * Where a range sits in a log, in bytes, as the offsets a window is taken between.
 *
 * A range names two moments and the file holds neither, so each end has to be
 * found in it: `since` is the first entry at or after it and `until` is the first
 * entry past it. A moment with no entries on its far side is the file's own end,
 * which is what makes "from three o'clock onwards" open-ended without a second
 * case.
 *
 * @param {Number} size how much the file holds
 * @param {Function} at where a stamp begins in the file, or `size`
 * @param {Object} [range] `since` and `until`, either of which may be absent
 * @return {{from: Number, to: Number}|null}
 */
const boundsOf = (size, at, {since, until} = {}) => {
  if (!since && !until) {
    return null
  }

  // a range that names only its end starts where the file does
  const from = since ? at(since, false) : 0
  const to = until ? at(until, true) : size

  return {from, to: Math.max(to, from)}
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
/**
 * The php that answers with one window onto a file the other machine holds.
 *
 * One round trip for the whole of it, range or no range: the file is there and
 * this process is not, so the machine that holds it finds where the range begins
 * and ends, then reads the bytes between the window's own ends and answers with
 * all of it. `fgets` is what makes the scan readable -- php reads a line for us,
 * so there is no chunk-and-split here and no byte of a multi-byte character to
 * worry about -- and the stamp is the header's or the json formatter's, the same
 * two the local seek reads.
 *
 * @param {String} file the path on that machine
 * @param {Number} wanted how wide the window is
 * @param {String} ends the php that says where the window ends
 * @param {String} since the moment the range starts at, or ''
 * @param {String} until the moment it ends at, or ''
 * @return {String}
 */
const windowPhp = (file, wanted, ends, since, until) => [
  '$f=' + phpString(file) + ';',
  '$n=@filesize($f);',
  'if($n===false){exit(1);}',
  '$from=0;$to=$n;',
  '$wantFrom=' + phpString(since || '') + ';$wantTo=' + phpString(until || '') + ';',
  'if($wantFrom!==\'\'||$wantTo!==\'\'){',
  '$h=fopen($f,\'r\');$off=0;$seen=-1;$stop=-1;',
  'while(($line=fgets($h))!==false){',
  '$at=$off;$off+=strlen($line);$stamp=null;',
  'if(isset($line[0])&&$line[0]===\'[\'){$stamp=substr($line,1,19);}',
  // php's preg_match takes the pattern as a string, not as a bare /regex/ literal
  'elseif(preg_match(\'/"datetime"\\s*:\\s*"([^"]+)"/\',$line,$m)){',
  '$stamp=substr(str_replace(\'T\',\' \',$m[1]),0,19);}',
  'if($stamp===null){continue;}',
  'if($seen<0&&$wantFrom!==\'\'&&strcmp($stamp,$wantFrom)>=0){$seen=$at;}',
  'if($wantTo!==\'\'&&strcmp($stamp,$wantTo)>0){$stop=$at;break;}',
  '}',
  'fclose($h);',
  'if($wantFrom!==\'\'){$from=($seen<0?$n:$seen);}',
  'if($stop>=0){$to=$stop;}',
  '}',
  'if($to<$from){$to=$from;}',
  '$end=min(' + ends + ',$to);',
  '$start=max($end-' + wanted + ',$from);',
  '$h=fopen($f,\'r\');',
  'fseek($h,$start);',
  "echo json_encode(['size'=>$n,'from'=>$from,'to'=>$to,'start'=>$start," +
    "'text'=>stream_get_contents($h,$end-$start)],JSON_INVALID_UTF8_SUBSTITUTE);",
].join('')

/**
 * One window onto a file that lives on another machine, asked for in one trip.
 *
 * @param {Record<String, any>} connection
 * @param {String} name a file in the connection's log directory, by name
 * @param {Object} [options] `bytes`, `before`, and the `since`/`until` of a range
 * @return {Promise<Object>} `size`, `from`, `to`, `start` and `text`
 */
const sshWindow = async (connection, name, {bytes, before, since, until} = {}) => {
  const file = path.join(dirOf(connection), name)
  const wanted = wantedOf(bytes)
  // where the end of the file is is what the other machine knows and this one does
  // not, so a window that ends there is the one thing the php is told to work out
  const ends = before == null ? '$n' : String(Math.max(Number(before) || 0, 0))

  let described = null

  try {
    described = JSON.parse(await ask(connection, windowPhp(file, wanted, ends, since, until)))
  } catch (e) {
    // an answer that is not a size and three offsets is no answer
    described = null
  }

  if (!described || typeof described.size !== 'number' || typeof described.text !== 'string') {
    throw new Error(`${name} is not there any more.`)
  }

  const size = Number(described.size)
  const from = Math.min(Math.max(Number(described.from) || 0, 0), size)
  const to = Math.min(Math.max(Number(described.to) || size, from), size)
  const start = Math.min(Math.max(Number(described.start) || 0, from), to)
  const read = Buffer.byteLength(described.text)

  return windowOf(name, size, start, start + read, described.text, {from, to}, start === from)
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
 * A range narrows the file before the window is taken: `since` and `until` are
 * found in it by reading it, so the window a range answers with is the end of the
 * range rather than the end of the file.
 *
 * @param {Record<String, any>} connection
 * @param {String} name a file in the connection's log directory, by name
 * @param {Object} [options] `bytes`, `before`, and the `since`/`until` of a range
 * @return {Object|Promise<Object>} `text`, `entries`, and what was read of what there is
 */
const read = (connection, name, {bytes, before, since, until} = {}) => {
  // the name comes from a window, and a window has no business naming a path
  if (name !== path.basename(name) || !name.endsWith('.log')) {
    throw new Error(`${name} is not a log file of this connection.`)
  }

  if (connection && connection.is_over_ssh) {
    return sshWindow(connection, name, {bytes, before, since, until})
  }

  const file = path.join(dirOf(connection), name)
  const wanted = wantedOf(bytes)

  let size

  try {
    size = fs.statSync(file).size
  } catch (e) {
    throw new Error(`${name} is not there any more.`)
  }

  const range = boundsOf(size, (stamp, after) => seekLocal(file, stamp, after), {since, until})
  const from = range ? range.from : 0
  const to = range ? range.to : size
  const end = Math.min(endOf(before, size), to)
  const start = Math.max(end - wanted, from)
  const descriptor = fs.openSync(file, 'r')

  let text = ''

  try {
    const buffer = Buffer.alloc(end - start)

    fs.readSync(descriptor, buffer, 0, buffer.length, start)
    text = buffer.toString('utf8')
  } finally {
    fs.closeSync(descriptor)
  }

  // a window that starts where the range does starts on a line the seek found,
  // so the first line of it is whole and must not be dropped
  return windowOf(name, size, start, end, text, {from, to}, start === from)
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
