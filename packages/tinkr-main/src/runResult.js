const {randomBytes} = require('crypto')

const {stripRendering} = require('./terminalOutput')

/**
 * The marker the run prints as the first thing it does.
 *
 * Everything the session wrote before it belongs to the session booting — the
 * prompt the shell starts with, the connection's command, the banner psysh
 * prints, the readline echoing the wrapped command back — and none of it is the
 * run's output. Waiting for the echo of the wrapped command is not enough to
 * tell the two apart: the shell echoes the line long before psysh is up, so
 * psysh's banner still follows it.
 *
 * @return {String}
 */
const createStartMarker = () => `STRT${randomBytes(6).toString('hex').toUpperCase()}`

/**
 * A run is wrapped so the session prints the value of the snippet between two
 * markers instead of only rendering it as text:
 *
 *   <marker>@<base64 of the json value>@
 *
 * The marker is new for every run, so an answer that arrives late can never be
 * read as another run's, and so the filter below can hold back a marker that is
 * split across two chunks of the stream.
 *
 * `@` is not in the base64 alphabet and the terminal never writes one while it
 * renders, so the first `@` after the marker ends the value.
 *
 * @return {String}
 */
const createMarker = () => `TINKR${randomBytes(6).toString('hex').toUpperCase()}`

/**
 * Whether the snippet is one expression, which is what a scratchpad means by
 * `User::first()`.
 *
 * This matters because `eval('return X; more;')` parses: X runs, everything
 * after it is dead code. So the session only gets the returning form when there
 * is nothing after the expression to lose.
 *
 * @param {String} code
 * @return {Boolean}
 */
const isSingleExpression = code => !code.trim().replace(/;+$/, '').includes(';')

/**
 * A php single quoted string, which is only backslashes and quotes to escape.
 *
 * @param {String} value
 * @return {String}
 */
const phpString = value => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/**
 * The php that puts the classes the snippet named into the session, by their
 * short name, before the snippet runs.
 *
 * A `use` statement cannot be written into an eval'd snippet, but `class_alias`
 * is a function called at run time, so `class_alias('App\Models\Order',
 * 'Order')` is what a missing `use App\Models\Order;` would have done.
 *
 * A name the session already answers to is left alone — what `Carbon`, `Str`
 * and php's own names are, and what a class the session ran earlier is — and a
 * name whose alias cannot be made is dropped rather than raised: the alias is a
 * convenience, an error in it must not become the run's error. `$tinkr_imported`
 * is what actually happened, and it is what the output reports.
 *
 * @param {Array<Array<String>>} entries short name => fully qualified name
 * @return {String} one line, or nothing when there is nothing to import
 */
const importBlock = entries => {
  if (entries.length === 0) {
    return ''
  }

  const map = entries.map(([name, qualified]) => `${phpString(name)}=>${phpString(qualified)}`).join(',')
  const defined = ['class_exists', 'interface_exists', 'trait_exists']
    .map(check => `${check}($tinkr_name)`)
    .join('||')

  return '$tinkr_imported=[];' +
    `foreach([${map}] as $tinkr_name=>$tinkr_class){` +
    `try{if(${defined}||(function_exists('enum_exists')&&enum_exists($tinkr_name))){continue;}` +
    'if(@class_alias($tinkr_class,$tinkr_name)){$tinkr_imported[$tinkr_name]=$tinkr_class;}}' +
    'catch(\\Throwable $tinkr_import_failure){}' +
    '}'
}

/**
 * Wrap a snippet so the session prints its value as json.
 *
 * The snippet is passed as base64 so nothing in it has to be escaped. An
 * expression is evaluated as the returned value, anything else as plain
 * statements (what `$user = User::first(); echo $user->name;` is), with the
 * returning form as a second try when the guess does not parse. eval keeps the
 * scope of the session, so the variables of earlier runs are visible.
 *
 * php parses what eval is given as a script and wants its last statement
 * terminated, which is what the `;` appended to both forms is for: a scratchpad
 * writes `$user->name` and `$user->name; $user->email` without it, and both are
 * parse errors on their own.
 *
 * The marker is built from two pieces so it never shows up in the echo of the
 * line itself: the filter would otherwise find the marker in that echo, which
 * has no closing marker, and swallow the value that comes later.
 *
 * A run that resolved no import is the run the app has always sent, line for
 * line: a project without a composer directory cannot tell that this is here.
 *
 * @param {String} source
 * @param {Object<String, String>} [imports] short class name => fully qualified
 * name, as classIndex.importsFor resolves them
 * @return {{marker: String, start: String, imports: Object, code: String}}
 */
const wrapRun = (source, imports = {}) => {
  // a snippet can be written like a file and open with `<?php`, but it is eval'd
  // here, where the opening tag is a parse error, so it is dropped
  const code = source.replace(/^\s*<\?(?:php)?\s*/, '')

  const marker = createMarker()
  const start = createStartMarker()
  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const entries = Object.entries(imports)
  const imported = entries.length ? ",'imported'=>(object)$tinkr_imported" : ''
  const split = 4
  const returns = "eval('return '.$tinkr_code.';')"

  return {
    marker,
    start,
    imports,
    code: [
      `$tinkr='${marker.slice(0, split)}'.'${marker.slice(split)}';`,
      `$tinkr_start='${start.slice(0, split)}'.'${start.slice(split)}';`,
      `$tinkr_code=base64_decode('${encoded}');`,
      '$tinkr_error=null;',
      importBlock(entries),
      // the pane reads the run from here: everything the session printed before
      // this line is the session booting
      'echo $tinkr_start;',
      'try{',
      isSingleExpression(code)
        ? `try{$tinkr_value=${returns};}catch(\\ParseError $tinkr_parse){$tinkr_value=eval($tinkr_code.';');}`
        : "$tinkr_value=eval($tinkr_code.';');",
      '}catch(\\Throwable $tinkr_failure){',
      "$tinkr_error=['class'=>get_class($tinkr_failure),'message'=>$tinkr_failure->getMessage()];",
      '}',
      `echo $tinkr,'@',base64_encode(json_encode(['value'=>$tinkr_value ?? null,'error'=>$tinkr_error${imported}],JSON_PARTIAL_OUTPUT_ON_ERROR)),'@';`,
    ].join(''),
  }
}

/**
 * Lifts the envelope out of what the session prints.
 *
 * Everything the session writes is forwarded to the terminal except the
 * envelope, which turns into the parsed value instead. A marker can arrive
 * split across two chunks, so a tail that could still become one is held back
 * until the next chunk says whether it was.
 */
// what the session echoes back before it runs the wrapped command, so the
// filter can swallow it however the chunks happen to split
const ECHO = '=base64_decode('

class RunResultFilter {
  /**
   * @param {String} marker the marker the value is printed inside
   * @param {String} start the marker the run prints before it evaluates
   */
  constructor(marker, start) {
    this.marker = marker
    this.start = start
    this.buffer = ''
    this.capturing = false
    this.captured = ''
    // what the run printed, once the session stopped booting, up to the envelope
    this.printed = ''
    this.started = false
    // whether the marker's own line ending has been dropped from the run yet
    this.trimmed = false
    this.done = false
    // a marker can arrive split across chunks, so a tail long enough to still
    // hold one is held back until the next chunk settles whether it was there
    this.tail = ''
  }

  /**
   * The run's own output, out of what the session wrote.
   *
   * The run prints its start marker as the first thing it does, and everything
   * the session wrote before it is the session booting: the prompt the shell
   * starts with, the connection's command, the banner psysh prints, the
   * readline echoing the wrapped command back. None of it is the run's, and it
   * shares a chunk with the marker more often than not.
   *
   * The cut is made on the text rather than on whole lines, because nothing
   * says a line ends where the marker does: with nothing between them, psysh
   * writes the value right after the marker.
   *
   * @param {String} text
   * @return {String}
   */
  runOf(text) {
    let rest = text

    if (!this.started) {
      const at = rest.indexOf(this.start)

      if (at === -1) {
        return ''
      }

      this.started = true
      this.printed = ''
      rest = rest.slice(at + this.start.length)
    }

    const out = rest.split(this.start).join('')

    // the marker is the app's own, wherever else it turns up, and the line
    // ending it is printed with is not the run's output: psysh usually merges
    // that away, but not always
    if (this.trimmed || out === '') {
      return out
    }

    this.trimmed = true

    return out.replace(/^\r?\n/, '')
  }

  /**
   * @param {String} data
   * @return {{output: String, run: String, result: Object|null}} `output` is
   * what is left of the chunk for the terminal, `run` is the run's own stream
   * once the snippet was handed the session, and `result` is set once the value
   * came in
   */
  push(data) {
    const buffer = this.buffer + data

    this.buffer = ''

    if (this.capturing) {
      return this.capture(buffer)
    }

    const found = buffer.indexOf(this.marker)

    if (found === -1) {
      // keep a tail that could still be the beginning of a marker
      const held = this.heldTail(buffer)

      this.buffer = held

      let output = this.tail + buffer.slice(0, buffer.length - held.length)

      this.tail = ''

      // the partial line is held until it ends, so a line is always seen whole
      const lastNewline = output.lastIndexOf('\n')

      this.tail = output.slice(lastNewline + 1)
      output = output.slice(0, lastNewline + 1)

      // the session echoes the wrapped command back (the shell once, and its
      // readline again); that echo is the point the session stops booting and
      // the snippet starts printing
      const run = this.runOf(output)

      if (this.started && !this.done) {
        this.printed += run
      }

      // the terminal keeps the session as it is, minus the readline echoing the
      // wrapped command back
      const terminal = output
        .split('\n')
        .filter(line => !line.includes(ECHO))
        .join('\n')
        .split(this.start)
        .join('')

      return {output: terminal, run: this.done ? '' : run, result: null}
    }

    const before = this.tail + buffer.slice(0, found)

    this.tail = ''

    // the marker the run prints first is in this chunk as often as not: the
    // value it printed is written right after it
    const run = this.runOf(before)

    if (this.started && !this.done) {
      this.printed += run
    }

    this.capturing = true

    const captured = this.capture(buffer.slice(found + this.marker.length))

    return {
      output: before.split(this.start).join('') + captured.output,
      run,
      result: captured.result,
    }
  }

  /**
   * @param {String} data everything after the opening marker
   * @return {{output: '', result: Object|null}}
   */
  capture(data) {
    this.captured += data

    const end = this.captured.indexOf('@', 1)

    if (end === -1) {
      return {output: '', run: '', result: null}
    }

    const payload = this.captured.slice(0, end)
    const rest = this.captured.slice(end + 1)

    this.capturing = false
    this.captured = ''
    // the run is over: what follows is the session's own prompt
    this.done = true

    // whatever the chunk holds after the envelope belongs to the terminal
    const next = rest ? this.push(rest) : {output: '', run: '', result: null}

    return {output: next.output, run: next.run, result: parseResult(payload) || next.result}
  }

  /**
   * @param {String} data
   * @return {String} the longest tail of `data` that is a prefix of the marker
   */
  heldTail(data) {
    const longest = Math.max(this.marker.length, this.start.length) - 1

    for (let length = Math.min(longest, data.length); length > 0; length--) {
      const tail = data.slice(data.length - length)

      if (this.marker.startsWith(tail) || this.start.startsWith(tail)) {
        return tail
      }
    }

    return ''
  }
}

/**
 * @param {String} payload base64 json, with whatever the terminal rendered into it
 * @return {Object|null}
 */
const parseResult = payload => {
  const base64 = stripRendering(payload).replace(/[^A-Za-z0-9+/=]/g, '')

  try {
    // the session prints {value, error}
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
  } catch (e) {
    return null
  }
}

module.exports = {
  createMarker,
  createStartMarker,
  wrapRun,
  RunResultFilter,
  phpString,
  parseResult,
}
