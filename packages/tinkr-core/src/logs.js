const fs = require('fs')
const path = require('path')
const readline = require('readline')

const {phpString} = require('./runResult')
const {containerRead, containerPath, inContainer} = require('./containerCommand')
const {isCloud} = require('./cloud')
const {exec, quoted} = require('./remote')

/**
 * The application's log files, as Laravel writes them, for the app's viewer and
 * for the MCP server's tools alike.
 *
 * One implementation of what a window is, of what an entry is, of where a range
 * sits in a file and of how a machine this one is not on is asked, so a log an
 * agent reads is the log a person sees. What differs between the two is only
 * what each asks for: the window's width, the range, and the filters.
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

// what a window is unless it is asked for more, and the most it will be
const defaultBytes = 128 * 1024
const maxBytes = 2 * 1024 * 1024

// where laravel puts them, relative to the project: a project that keeps its own
// somewhere else says so in the app's preferences
const defaultDir = 'storage/logs'

// how many entries a filtered read answers with unless it is asked for more, and
// the most it will answer with: an entry can be a whole stack trace, and a
// thousand of them is a reader that cannot read
const defaultLimit = 100
const maxLimit = 500

// the header of an entry: `[when] environment.LEVEL: what it says`
const header = /^\[([^\]]+)\]\s+([^.\s]+)\.([A-Z]+):\s?([\s\S]*)$/

// monolog's json formatter writes one object per line and no header at all:
// `{"message":"…","context":{…},"level":400,"level_name":"ERROR","channel":"local","datetime":"…"}`.
// Read as ordinary lines it is one headerless entry whose details are the rest
// of the file, so its level can never be filtered on
const jsonLine = /^\s*\{.*"level_name"\s*:.*\}\s*$/

// the levels monolog knows, which is what a filter offers
const levels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']

// what a Laravel Cloud connection answers about its logs: the app has no
// filesystem in that environment to read, and the API's own log endpoint is not
// something this viewer is written against (see the plan's own scope note)
const cloudUnavailable = 'Logs are not available for Laravel Cloud connections.'

/**
 * Where a connection's log files are.
 *
 * `storage/logs` is where Laravel puts them; a project that keeps its own
 * somewhere else says so in the preferences, relative to the project.
 *
 * @param {Record<String, any>} connection
 * @param {String} [logDir] the directory the preferences name
 * @return {String}
 */
const dirOf = (connection, logDir = defaultDir) => path.join(connection.path || '', logDir || defaultDir)

/**
 * Where a connection's log files are, as the machine that reads them spells it.
 *
 * A local project's logs are on this machine, at the path the project has here.
 * A project in a container has them inside it, at the path the container has:
 * `container_path` when the connection names one, and otherwise the same path,
 * which is what a project mounted in at its host path is.
 *
 * @param {Record<String, any>} connection
 * @param {String} [logDir] the directory the preferences name
 * @return {String}
 */
const readDirOf = (connection, logDir = defaultDir) => (inContainer(connection)
  ? path.join(containerPath(connection), logDir || defaultDir)
  : dirOf(connection, logDir))

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
 * @param {String|null} [dataDir] where the app's data is, which is where a
 *   connection's saved password is
 * @return {Promise<String|null>}
 */
const ask = async (connection, code, dataDir = null) => {
  const question = `php -r ${quoted(code)}`
  // a project in a container keeps its logs in the container, and its php with
  // them: the question is asked in there, from the directory the logs are in
  const inside = containerRead(connection, question)

  const answer = await exec(connection, inside || question, {dataDir})

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
 * @param {{logDir?: String, dataDir?: String}} [settings]
 * @return {Promise<Object>} `files`, and `dir` for the panel to say where it looked
 */
const sshFiles = async (connection, {logDir = defaultDir, dataDir = null} = {}) => {
  const dir = readDirOf(connection, logDir)

  const listing = await ask(
    connection,
    '$tinkr_dir=' + phpString(dir) + ';' +
    "foreach(glob($tinkr_dir.'/*.log') as $tinkr_file){" +
    'echo basename($tinkr_file),"\\t",filesize($tinkr_file),"\\t",(int)round(filemtime($tinkr_file)*1000),"\\n";' +
    '}',
    dataDir,
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
 * @param {{logDir?: String, dataDir?: String}} [settings] `logDir` is the
 *   directory the app's preferences name, and `dataDir` is where a connection's
 *   saved password is
 * @return {Object|Promise<Object>} `files`, and `dir` for the panel to say where it looked
 */
const files = (connection, {logDir = defaultDir, dataDir = null} = {}) => {
  // a cloud connection has no project on this machine to read, and no log
  // directory of its own here: its path is a local checkout that is not the
  // environment's, so reading it would be showing the wrong machine's logs
  if (isCloud(connection)) {
    throw new Error(cloudUnavailable)
  }

  if (connection && connection.is_over_ssh) {
    return sshFiles(connection, {logDir, dataDir})
  }

  const dir = dirOf(connection, logDir)

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
 * A log read a line at a time: one entry per line that starts one, and what
 * follows it.
 *
 * A line that starts nothing belongs to the entry above it — a stack trace, the
 * rest of a json context — and a line that starts nothing and has no entry above
 * it is shown as it is, because it is in the file and hiding it would be lying
 * about what the file holds.
 *
 * It is a reader rather than a function over an array because a whole file is
 * read a line at a time: a filtered read walks a log of any size and holds the
 * entry in hand and the matches it will answer with, never the file.
 *
 * @return {{feed: Function, end: Function}}
 */
const readerOf = () => {
  let current = null

  return {
    /**
     * @param {String} line
     * @return {Object|null} the entry this line completed, if it completed one
     */
    feed(line) {
      // a file written on windows ends its lines with a carriage return, and a
      // carriage return is not part of what the line says
      const text = line.endsWith('\r') ? line.slice(0, -1) : line
      const asJson = jsonEntry(text)

      if (asJson) {
        const done = current

        current = asJson

        return done
      }

      const found = header.exec(text)

      if (found) {
        const [, at, environment, level, rest] = found
        // the json context a formatter appended starts at the first ` {` after
        // the message; everything from there is the entry's details
        const context = rest.search(/\s\{/)
        const done = current

        current = {
          at,
          environment,
          level: level.toLowerCase(),
          message: context === -1 ? rest : rest.slice(0, context),
          details: context === -1 ? '' : rest.slice(context + 1),
        }

        return done
      }

      if (current === null) {
        current = {at: null, environment: null, level: null, message: text, details: ''}

        return null
      }

      current.details = current.details === '' ? text : `${current.details}\n${text}`

      return null
    },

    /**
     * @return {Object|null} the entry the log ends in, if it ends in one
     */
    end() {
      const done = current

      current = null

      return done
    },
  }
}

/**
 * What the lines of a log are, as the same reader reads them.
 *
 * @param {Array<String>} lines
 * @return {Array<Object>}
 */
const parse = lines => {
  const reader = readerOf()
  const entries = []

  for (const line of lines) {
    const done = reader.feed(line)

    if (done) {
      entries.push(done)
    }
  }

  const last = reader.end()

  if (last) {
    entries.push(last)
  }

  return entries
}

/**
 * The levels a filtered read keeps, lowercase and as a set.
 *
 * A level is monolog's own word for one, and a word it does not know is refused
 * rather than matching nothing: a filter that answered "no errors" because it was
 * asked for "eror" is a wrong answer that reads like a right one.
 *
 * @param {String|Array<String>} [level]
 * @return {Array<String>}
 */
const levelsOf = level => {
  const wanted = level === undefined || level === null || level === '' ? [] : (Array.isArray(level) ? level : [level])
  const names = wanted.map(one => String(one).toLowerCase())

  for (const name of names) {
    if (!levels.includes(name)) {
      throw new Error(`"${name}" is not a level a log holds. The levels are ${levels.join(', ')}.`)
    }
  }

  return [...new Set(names)]
}

/**
 * How many entries a filtered read answers with: what was asked for, within what
 * is worth reading.
 *
 * @param {Number} [limit]
 * @return {Number}
 */
const limitOf = limit => Math.min(Math.max(Number(limit) || defaultLimit, 1), maxLimit)

/**
 * Whether an entry survives a filtered read.
 *
 * The level is the entry's own, and a line that belongs to no entry has none: a
 * level filter leaves those out, because a stack trace is not an error of its
 * own. The term is what the app's own search looks for, in the same text and the
 * same way — anywhere in the entry, without case.
 *
 * @param {Object} entry
 * @param {{levels: Array<String>, term: String}} filter
 * @return {Boolean}
 */
const passes = (entry, {levels: wanted, term}) => {
  if (wanted.length > 0 && (entry.level === null || !wanted.includes(entry.level))) {
    return false
  }

  if (term === '') {
    return true
  }

  return `${entry.at} ${entry.level} ${entry.message} ${entry.details}`.toLowerCase().includes(term)
}

/**
 * What a stream of lines holds that survives a filter, newest last, and how many
 * matches were older than the ones kept.
 *
 * The whole region is walked, not just its end: a match that is forty megabytes
 * back is still a match, and a reader that answered "nothing" because it only
 * looked at the last page would be lying about the file.
 *
 * @param {AsyncIterable<String>|Iterable<String>} lines
 * @param {{levels: Array<String>, term: String, limit: Number}} filter
 * @return {Promise<{entries: Array<Object>, older: Number}>}
 */
const collect = async (lines, filter) => {
  const reader = readerOf()
  const entries = []
  let older = 0

  const keep = entry => {
    if (!entry || !passes(entry, filter)) {
      return
    }

    entries.push(entry)

    // the newest matches are the ones kept, so the oldest falls off the front
    if (entries.length > filter.limit) {
      entries.shift()
      older += 1
    }
  }

  for await (const line of lines) {
    // a blank line separates what a formatter wrote; it is not an entry of its
    // own, and the window's own reading leaves those out too
    if (line !== '') {
      keep(reader.feed(line))
    }
  }

  keep(reader.end())

  return {entries, older}
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
 * Whether a byte offset begins a line of a file.
 *
 * A region read from an offset that is not a line's beginning starts with the
 * tail of a line somebody else has already read: the first line of such a region
 * is dropped rather than shown as a mangled entry. A newline is one byte and no
 * byte of a multi-byte character can be one, so the test is a byte before the
 * offset and nothing more.
 *
 * @param {Number} descriptor an open file descriptor to the file
 * @param {Number} at a byte offset
 * @return {Boolean}
 */
const beginsLine = (descriptor, at) => {
  if (at === 0) {
    return true
  }

  const byte = Buffer.alloc(1)

  fs.readSync(descriptor, byte, 0, 1, at - 1)

  return byte[0] === 10
}

/**
 * The entries of a region of a log that survive a filter, read here.
 *
 * The region is walked as a stream: a log of forty megabytes costs the entry in
 * hand and the matches kept, never the file. What comes out is the newest
 * matches, because the question a filter asks — "what errors were there" — is a
 * question about the end of a log.
 *
 * @param {String} file a path
 * @param {{from: Number, to: Number}} region
 * @param {{levels: Array<String>, term: String, limit: Number}} filter
 * @return {Promise<{entries: Array<Object>, older: Number}>}
 */
const scanLocal = async (file, {from, to}, filter) => {
  if (to <= from) {
    return {entries: [], older: 0}
  }

  const descriptor = fs.openSync(file, 'r')

  let whole = true

  try {
    whole = beginsLine(descriptor, from)
  } finally {
    fs.closeSync(descriptor)
  }

  const lines = readline.createInterface({
    input: fs.createReadStream(file, {start: from, end: to - 1}),
    crlfDelay: Infinity,
  })

  let skip = whole ? 0 : 1

  try {
    return await collect((async function * () {
      for await (const line of lines) {
        if (skip > 0) {
          skip -= 1

          continue
        }

        yield line
      }
    })(), filter)
  } finally {
    lines.close()
  }
}

/**
 * A list of strings as php writes one.
 *
 * @param {Array<String>} values
 * @return {String}
 */
const phpArray = values => `array(${values.map(one => phpString(one)).join(',')})`

/**
 * The php that answers with the entries of a region of a log that survive a
 * filter, on a machine this one is not on.
 *
 * One round trip: the machine reads its own file a line at a time, groups the
 * lines into entries the way the viewer does, keeps the matches that were asked
 * for — the newest of them — and answers with those and the size of the file.
 * Nothing but the matches crosses.
 *
 * A log that is json per line is read as one, and a header's own context is read
 * as the rest of the line after the first ` {`: the same two readings as the
 * local parse, because an agent and a person have to see the same entries.
 *
 * @param {String} file the path on that machine
 * @param {{from: Number, to: Number}} region
 * @param {{levels: Array<String>, term: String, limit: Number}} filter
 * @return {String}
 */
const scanPhp = (file, {from, to}, {levels: wanted, term, limit}) => [
  '$tinkr_file=' + phpString(file) + ';',
  '$tinkr_n=@filesize($tinkr_file);if($tinkr_n===false){exit(1);}',
  '$tinkr_from=min(max(' + Math.max(Number(from) || 0, 0) + ',0),$tinkr_n);',
  '$tinkr_to=min(max(' + Math.max(Number(to) || 0, 0) + ',$tinkr_from),$tinkr_n);',
  '$tinkr_levels=' + phpArray(wanted) + ';',
  // php\'s own strtolower is byte-wise, and a log written in anything but ascii
  // has letters it leaves alone; mbstring is the one that knows them
  '$tinkr_lower=function_exists(\'mb_strtolower\')?\'mb_strtolower\':\'strtolower\';',
  '$tinkr_term=$tinkr_lower(' + phpString(term) + ');',
  '$tinkr_limit=' + Math.max(Number(limit) || 1, 1) + ';',
  '$tinkr_h=fopen($tinkr_file,\'r\');if($tinkr_h===false){exit(1);}',
  // a region that starts mid-line starts with the tail of a line already read:
  // the tail is dropped, the way the local read drops it
  '$tinkr_whole=($tinkr_from===0);',
  'if(!$tinkr_whole){fseek($tinkr_h,$tinkr_from-1);$tinkr_whole=(fread($tinkr_h,1)==="\n");}',
  'fseek($tinkr_h,$tinkr_from);',
  'if(!$tinkr_whole){fgets($tinkr_h);}',
  '$tinkr_out=array();$tinkr_older=0;$tinkr_cur=null;',
  '$tinkr_keep=function()use(&$tinkr_cur,&$tinkr_out,&$tinkr_older,$tinkr_levels,$tinkr_term,$tinkr_limit,$tinkr_lower){',
  'if($tinkr_cur===null){return;}',
  '$tinkr_e=$tinkr_cur;$tinkr_cur=null;',
  'if(count($tinkr_levels)>0&&($tinkr_e[\'level\']===null||!in_array($tinkr_e[\'level\'],$tinkr_levels,true))){return;}',
  'if($tinkr_term!==\'\'){',
  '$tinkr_hay=$tinkr_lower($tinkr_e[\'at\'].\' \'.$tinkr_e[\'level\'].\' \'.$tinkr_e[\'message\'].\' \'.$tinkr_e[\'details\']);',
  'if(strpos($tinkr_hay,$tinkr_term)===false){return;}',
  '}',
  '$tinkr_out[]=$tinkr_e;',
  'if(count($tinkr_out)>$tinkr_limit){array_shift($tinkr_out);$tinkr_older++;}',
  '};',
  'while(true){',
  '$tinkr_at=ftell($tinkr_h);',
  'if($tinkr_at===false||$tinkr_at>=$tinkr_to){break;}',
  '$tinkr_line=fgets($tinkr_h);if($tinkr_line===false){break;}',
  '$tinkr_line=rtrim($tinkr_line,"\r\n");',
  'if($tinkr_line===\'\'){continue;}',
  // monolog\'s json formatter: one object per line, and no header at all
  'if(preg_match(\'/^\\s*\\{.*"level_name"\\s*:.*\\}\\s*$/\',$tinkr_line)){',
  '$tinkr_v=json_decode($tinkr_line,true);',
  'if(is_array($tinkr_v)&&isset($tinkr_v[\'level_name\'])&&is_string($tinkr_v[\'level_name\'])){',
  '$tinkr_keep();',
  '$tinkr_level=strtolower($tinkr_v[\'level_name\']);',
  '$tinkr_stamp=isset($tinkr_v[\'datetime\'])&&is_string($tinkr_v[\'datetime\'])?$tinkr_v[\'datetime\']:null;',
  '$tinkr_env=isset($tinkr_v[\'channel\'])&&is_string($tinkr_v[\'channel\'])?$tinkr_v[\'channel\']:null;',
  '$tinkr_msg=isset($tinkr_v[\'message\'])&&is_string($tinkr_v[\'message\'])?$tinkr_v[\'message\']:\'\';',
  'unset($tinkr_v[\'message\'],$tinkr_v[\'level_name\'],$tinkr_v[\'datetime\'],$tinkr_v[\'channel\']);',
  // php\'s pretty json indents with four spaces and javascript\'s with two, and
  // the entry is the same entry whoever read it: the indentation is halved
  '$tinkr_details=count($tinkr_v)>0?json_encode($tinkr_v,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE):\'\';',
  '$tinkr_details=preg_replace_callback(\'/^ +/m\',function($tinkr_m){return str_repeat(\'  \',intdiv(strlen($tinkr_m[0]),4));},$tinkr_details);',
  '$tinkr_cur=array(\'at\'=>$tinkr_stamp,\'environment\'=>$tinkr_env,\'level\'=>$tinkr_level,\'message\'=>$tinkr_msg,',
  '\'details\'=>$tinkr_details);',
  'continue;',
  '}',
  '}',
  // the header of an entry: `[when] environment.LEVEL: what it says`
  'if(preg_match(\'/^\\[([^\\]]+)\\]\\s+([^.\\s]+)\\.([A-Z]+):\\s?(.*)$/\',$tinkr_line,$tinkr_m)){',
  '$tinkr_keep();',
  '$tinkr_rest=$tinkr_m[4];$tinkr_pos=strpos($tinkr_rest,\' {\');',
  '$tinkr_cur=array(\'at\'=>$tinkr_m[1],\'environment\'=>$tinkr_m[2],\'level\'=>strtolower($tinkr_m[3]),',
  '\'message\'=>$tinkr_pos===false?$tinkr_rest:substr($tinkr_rest,0,$tinkr_pos),',
  '\'details\'=>$tinkr_pos===false?\'\':substr($tinkr_rest,$tinkr_pos+1));',
  'continue;',
  '}',
  // a line that starts nothing belongs to the entry above it, and a line that
  // starts nothing and has no entry above it is shown as it is
  'if($tinkr_cur===null){',
  '$tinkr_cur=array(\'at\'=>null,\'environment\'=>null,\'level\'=>null,\'message\'=>$tinkr_line,\'details\'=>\'\');',
  '}else{',
  '$tinkr_cur[\'details\']=$tinkr_cur[\'details\']===\'\'?$tinkr_line:$tinkr_cur[\'details\']."\n".$tinkr_line;',
  '}',
  '}',
  '$tinkr_keep();',
  "echo json_encode(array('size'=>$tinkr_n,'entries'=>$tinkr_out,'older'=>$tinkr_older),JSON_INVALID_UTF8_SUBSTITUTE);",
].join('')

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
const windowPhp = (file, wanted, ends, since, until, after = null) => [
  '$f=' + phpString(file) + ';',
  '$n=@filesize($f);',
  'if($n===false){exit(1);}',
  '$from=0;$to=$n;',
  '$wantFrom=' + phpString(since || '') + ';$wantTo=' + phpString(until || '') + ';',
  'if($wantFrom!==\'\'||$wantTo!==\'\'){',
  '$h=fopen($f,\'r\');$off=0;$seen=-1;$stop=-1;',
  'while(($line=fgets($h))!==false){',
  '$at=$off;$off+=strlen($line);$stamp=null;',
  // a header, not merely a line that starts with a bracket: `[stacktrace]` is
  // the continuation of the entry above it, and read as a header its `stacktrace]`
  // is a stamp that sorts after any range and ends the scan where it began
  'if(preg_match(\'/^\\[([^\\]]{19})\\] /\',$line,$m)){$stamp=$m[1];}',
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
  // a page can be asked for from where the previous one ended, which is how the
  // viewer walks towards the newest entries after it has walked back
  '$after=' + (after == null ? 'null' : String(Math.max(Number(after) || 0, 0))) + ';',
  '$start=$after===null?max(min(' + ends + ',$to)-' + wanted + ',$from):min(max($after,$from),$to);',
  '$end=$after===null?min(' + ends + ',$to):min($start+' + wanted + ',$to);',
  // a page that starts after the first byte is whole only when the byte before
  // it is a newline; otherwise its first line is the tail of one already read
  '$whole=($start===$from);',
  'if(!$whole&&$start>0){$h=fopen($f,\'r\');fseek($h,$start-1);$whole=(fread($h,1)==="\n");fclose($h);}',
  '$h=fopen($f,\'r\');',
  'fseek($h,$start);',
  "echo json_encode(['size'=>$n,'from'=>$from,'to'=>$to,'start'=>$start,'whole'=>$whole," +
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
const askWindow = async (connection, file, {bytes, before, since, until, after} = {}, dataDir = null) => {
  const wanted = wantedOf(bytes)
  // where the end of the file is is what the other machine knows and this one does
  // not, so a window that ends there is the one thing the php is told to work out
  const ends = before == null ? '$n' : String(Math.max(Number(before) || 0, 0))

  let described = null

  try {
    described = JSON.parse(await ask(connection, windowPhp(file, wanted, ends, since, until, after), dataDir))
  } catch (e) {
    // an answer that is not a size and three offsets is no answer
    described = null
  }

  if (!described || typeof described.size !== 'number' || typeof described.text !== 'string') {
    throw new Error(`${path.basename(file)} is not there any more.`)
  }

  const size = Number(described.size)

  return {
    size,
    from: Math.min(Math.max(Number(described.from) || 0, 0), size),
    to: Math.min(Math.max(Number(described.to) || size, 0), size),
    start: Math.min(Math.max(Number(described.start) || 0, 0), size),
    text: described.text,
    whole: Boolean(described.whole),
  }
}

/**
 * One window onto a file that lives on another machine.
 *
 * @param {Record<String, any>} connection
 * @param {String} name a file in the connection's log directory, by name
 * @param {Object} [options] `bytes`, `before`, and the `since`/`until` of a range
 * @param {{logDir?: String, dataDir?: String}} [settings]
 * @return {Promise<Object>} `text`, `entries`, and what was read of what there is
 */
const sshWindow = async (connection, name, options = {}, settings = {}) => {
  const file = path.join(readDirOf(connection, settings.logDir || defaultDir), name)
  const described = await askWindow(connection, file, options, settings.dataDir || null)
  const read = Buffer.byteLength(described.text)

  return windowOf(
    name,
    described.size,
    described.start,
    described.start + read,
    described.text,
    {from: described.from, to: described.to},
    described.whole,
  )
}

/**
 * The entries of a region of one of a connection's log files that lives on
 * another machine.
 *
 * Where the region is is a fact about the file's own bytes, and its size is the
 * file's: the one small window this asks for first is what answers both, and
 * then one php pass reads the region itself. Only the matches cross.
 *
 * @param {Record<String, any>} connection
 * @param {String} name a file in the connection's log directory, by name
 * @param {{from: Number, to: Number, size: Number}} region
 * @param {{levels: Array<String>, term: String, limit: Number}} filter
 * @param {{logDir?: String, dataDir?: String}} [settings]
 * @return {Promise<{entries: Array<Object>, older: Number}>}
 */
const scanSsh = async (connection, name, {from, to}, filter, settings = {}) => {
  const file = path.join(readDirOf(connection, settings.logDir || defaultDir), name)

  let described = null

  try {
    described = JSON.parse(await ask(connection, scanPhp(file, {from, to}, filter), settings.dataDir || null))
  } catch (e) {
    // an answer that is not the size of a file and a list of entries is no answer
    described = null
  }

  if (!described || typeof described.size !== 'number' || !Array.isArray(described.entries)) {
    throw new Error(`${name} is not there any more.`)
  }

  return {
    entries: described.entries.map(entry => ({
      at: typeof entry.at === 'string' ? entry.at : null,
      environment: typeof entry.environment === 'string' ? entry.environment : null,
      level: typeof entry.level === 'string' ? entry.level : null,
      message: typeof entry.message === 'string' ? entry.message : '',
      details: typeof entry.details === 'string' ? entry.details : '',
    })),
    older: Math.max(Number(described.older) || 0, 0),
  }
}

/**
 * The bytes a filtered read walks: the range a time filter names, cut down by
 * the byte offsets a caller pages with.
 *
 * @param {{size: Number, from: Number, to: Number}} edge the range in the file
 * @param {{after?: Number, before?: Number}} [options]
 * @return {{from: Number, to: Number, read: Number}}
 */
const regionOf = ({from, to}, {after, before} = {}) => {
  const start = after == null ? from : Math.min(Math.max(Number(after) || 0, from), to)
  const end = before == null ? to : Math.min(Math.max(Number(before) || 0, start), to)

  return {from: start, to: end, read: end - start}
}

/**
 * A window onto one of a connection's log files, or the entries of one that
 * survive a filter.
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
 * A filter changes what a read is. Without one it is a window: the newest bytes
 * of the range, paged by byte offsets. With a `level` or a `term` it is a scan:
 * the whole range is read, and the newest `limit` entries that match are the
 * answer, so an error that is forty megabytes back is still found. The two are
 * not the same question, and a window that answered a filter would say "nothing"
 * about entries that are plainly in the file.
 *
 * @param {Record<String, any>} connection
 * @param {String} name a file in the connection's log directory, by name
 * @param {Object} [options] `bytes`, `before` for a page ending at a byte,
 *   `after` for a page starting at one, the `since`/`until` of a range, and the
 *   `level`/`term`/`limit` of a filter
 * @param {{logDir?: String, dataDir?: String}} [settings] `logDir` is the
 *   directory the app's preferences name, and `dataDir` is where a connection's
 *   saved password is
 * @return {Object|Promise<Object>} `text`, `entries`, and what was read of what there is
 */
const read = (connection, name, {bytes, before, since, until, after, level, term, limit} = {}, settings = {}) => {
  // a cloud connection's logs are inside Laravel Cloud, and this reads files:
  // answering with a local checkout's log would be another machine's file
  if (isCloud(connection)) {
    throw new Error(cloudUnavailable)
  }

  // the name comes from a window, and a window has no business naming a path
  if (name !== path.basename(name) || !name.endsWith('.log')) {
    throw new Error(`${name} is not a log file of this connection.`)
  }

  const {logDir = defaultDir, dataDir = null} = settings
  const filter = {
    levels: levelsOf(level),
    term: typeof term === 'string' ? term.trim().toLowerCase() : '',
    limit: limitOf(limit),
  }
  const filtered = filter.levels.length > 0 || filter.term !== ''

  if (connection && connection.is_over_ssh) {
    if (!filtered) {
      return sshWindow(connection, name, {bytes, before, since, until, after}, {logDir, dataDir})
    }

    const file = path.join(readDirOf(connection, logDir), name)
    // the size of the file and where the range sits in it are the file's own
    // facts: one small window answers both, and then the region is scanned
    return (async () => {
      const edge = await askWindow(connection, file, {bytes: 4096, since, until}, dataDir)
      const region = regionOf(edge, {after, before})

      return Object.assign(
        {file: name, size: edge.size},
        region,
        await scanSsh(connection, name, region, filter, {logDir, dataDir}),
      )
    })()
  }

  const file = path.join(dirOf(connection, logDir), name)

  let size

  try {
    size = fs.statSync(file).size
  } catch (e) {
    throw new Error(`${name} is not there any more.`)
  }

  const range = boundsOf(size, (stamp, beyond) => seekLocal(file, stamp, beyond), {since, until})

  if (filtered) {
    const region = regionOf({from: range ? range.from : 0, to: range ? range.to : size}, {after, before})

    return scanLocal(file, region, filter).then(answer => Object.assign({file: name, size}, region, answer))
  }

  const from = range ? range.from : 0
  const to = range ? range.to : size
  // a page after a byte is read forward from it; a page before a byte is read
  // back from it. The viewer uses the first after it has walked back, and the
  // second to walk back.
  const at = after == null ? null : Math.min(Math.max(Number(after) || 0, from), to)
  const end = at === null ? Math.min(endOf(before, size), to) : Math.min(at + wantedOf(bytes), to)
  const start = at === null ? Math.max(end - wantedOf(bytes), from) : at
  const descriptor = fs.openSync(file, 'r')

  let text = ''
  let whole = start === from

  try {
    const buffer = Buffer.alloc(end - start)

    fs.readSync(descriptor, buffer, 0, buffer.length, start)
    text = buffer.toString('utf8')
    whole = whole || beginsLine(descriptor, start)
  } finally {
    fs.closeSync(descriptor)
  }

  return windowOf(name, size, start, end, text, {from, to}, whole)
}

module.exports = {
  defaultBytes,
  maxBytes,
  defaultDir,
  defaultLimit,
  maxLimit,
  levels,
  levelsOf,
  limitOf,
  dirOf,
  files,
  parse,
  read,
  scanPhp,
  stampOf,
  windowPhp,
}
