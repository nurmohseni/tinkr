const {stripNonCode} = require('tinkr-core')

/**
 * The variables of a snippet, as the fields of its form.
 *
 * `php-form`, which this replaces, is a WebAssembly build of a PHP 7 parser: it
 * rejects every construct php added after that — a nullsafe `?->`, named
 * arguments, `match`, an enum, a union type — with `syntax error: unexpected
 * T_OBJECT_OPERATOR`, and one of them anywhere in the snippet takes the whole
 * form down, including when the construct is nowhere near a field. A form is
 * not a compiler: what it needs is where each `$field_x = …;` starts and ends,
 * and that is a scan, not a parse.
 *
 * So the snippet is read the way a person reads it. `stripNonCode` (which
 * `tinkr-core` already uses to find the classes a snippet names) blanks every
 * string, heredoc and comment while keeping every offset and line break, so a
 * `;` inside a string is never a statement end and a `$field_x` inside a
 * comment is never a field. What is left is code, and the scan runs on that,
 * reading the values from the source at the same offsets.
 *
 * A field is a top-level assignment whose name carries the configured prefix:
 * a `$field_email = …;` in a function body is not one, because a form is the
 * snippet's own variables, not the insides of its methods. The value keeps the
 * text it was written with — `function () { … }`, `fn () => 2`, `[1, 2, 3]`,
 * `User::find(1)` — so a field is shown as the code it holds rather than as a
 * value a parser tried to reduce.
 *
 * The label, type and options a field may declare come from an array with
 * string keys, which is the shape `php-form` read and the one the form rows are
 * drawn from: `['label' => 'Email', 'value' => '…']`.
 */

/**
 * The keys of a field that are the form's own rather than the value's, and what
 * each one means.
 *
 * `value` is the one the field edits and the one `writeFields` writes back, so a
 * field declared with a surrounding array is edited at its `value` key and not
 * at the array around it.
 */
const declared = new Set(['label', 'value', 'type', 'options', 'description'])

/**
 * A name php lets a variable have, without its `$`.
 */
const namePattern = /^[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*$/

/**
 * The index of the `;` that closes the statement starting at `from`, or the
 * length of the source when there is none.
 *
 * `code` is the stripped source, so a `;` here is always a statement end: the
 * one inside a string or a comment was blanked. Brackets are counted anyway,
 * because a `for (;;)` and a closure's body hold semicolons that end nothing.
 *
 * @param {String} code stripped
 * @param {Number} from
 * @return {Number}
 */
const endOfStatement = (code, from) => {
  let depth = 0

  for (let at = from; at < code.length; at++) {
    const char = code[at]

    if (char === '(' || char === '[' || char === '{') {
      depth++
      continue
    }

    if (char === ')' || char === ']' || char === '}') {
      // a closing bracket that takes the depth below zero ends the enclosing
      // block: the statement was the last thing in it, and there is no `;`
      if (depth === 0) {
        return at
      }

      depth--
      continue
    }

    if (char === ';' && depth === 0) {
      return at
    }
  }

  return code.length
}

/**
 * The depth of every offset of the code: 0 is the top level, and a function
 * body, a class body or an array's own brackets are deeper.
 *
 * A field is a top-level assignment, which is what this is for: a `$field_x`
 * inside a closure is that closure's variable and not the form's.
 *
 * @param {String} code stripped
 * @return {Int32Array}
 */
const depthsOf = code => {
  const depths = new Int32Array(code.length)
  let depth = 0

  for (let at = 0; at < code.length; at++) {
    const char = code[at]

    depths[at] = depth

    if (char === '(' || char === '[' || char === '{') {
      depth++
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1)
    }
  }

  return depths
}

/**
 * One string literal of the source, read back as the characters it holds.
 *
 * The stripped code has it blanked, so this reads the source again at the same
 * offsets. A single quoted string is literal apart from `\\` and `\'`; a double
 * quoted one also reads `\n`, `\t`, `\$` and friends, which is what php does.
 *
 * @param {String} source
 * @param {Number} at the opening quote
 * @param {Number} end one past the closing quote
 * @return {String|null} the characters, or null for an interpolated string
 */
const stringValue = (source, at, end) => {
  const quote = source[at]
  const body = source.slice(at + 1, end - 1)

  // a double quoted string with a variable in it is not a value a form can read
  // back: `"hi $name"` is whatever `$name` is at run time
  if (quote === '"' && /(^|[^\\])\$[A-Za-z_\x80-\xff]/.test(body)) {
    return null
  }

  return body.replace(/\\(.)/g, (match, char) => {
    if (quote === '\'') {
      return char === '\\' || char === '\'' ? char : match
    }

    const named = {n: '\n', t: '\t', r: '\r', v: '\v', e: '\u001b', f: '\f', 0: '\0'}

    return named[char] !== undefined ? named[char] : char
  })
}

/**
 * The index of the end of a quoted string, escaped characters included.
 *
 * @param {String} source
 * @param {Number} start at the opening quote
 * @return {Number} one past the closing quote, or the end of the source
 */
const endOfString = (source, start) => {
  const quote = source[start]
  let at = start + 1

  while (at < source.length) {
    if (source[at] === '\\') {
      at += 2
      continue
    }

    if (source[at] === quote) {
      return at + 1
    }

    at++
  }

  return source.length
}

/**
 * The same source with every comment replaced by spaces, and every string left
 * as it is.
 *
 * `stripNonCode` blanks strings too, which is what finding statements needs and
 * what reading a value cannot use: a value that is a string is spaces there. So
 * the value's own edges are found in this, where whitespace is whitespace and a
 * `//` in a string is still a string.
 *
 * Offsets and line breaks are kept, so a position here is a position in the
 * snippet.
 *
 * @param {String} source
 * @return {String}
 */
const stripComments = source => {
  const out = source.split('')
  const blank = (from, to) => {
    for (let at = from; at < to; at++) {
      if (out[at] !== '\n' && out[at] !== '\r') {
        out[at] = ' '
      }
    }
  }

  let at = 0

  while (at < source.length) {
    const char = source[at]

    if (char === '\'' || char === '"' || char === '`') {
      at = endOfString(source, at)
      continue
    }

    if (char === '/' && source[at + 1] === '/') {
      const end = source.indexOf('\n', at)
      const stop = end === -1 ? source.length : end

      blank(at, stop)
      at = stop
      continue
    }

    if (char === '#' && source[at + 1] !== '[') {
      const end = source.indexOf('\n', at)
      const stop = end === -1 ? source.length : end

      blank(at, stop)
      at = stop
      continue
    }

    if (char === '/' && source[at + 1] === '*') {
      const close = source.indexOf('*/', at + 2)
      const stop = close === -1 ? source.length : close + 2

      blank(at, stop)
      at = stop
      continue
    }

    at++
  }

  return out.join('')
}

/**
 * Where a value starts and ends inside a statement, with the whitespace and the
 * comments around it left out.
 *
 * `commentless` is `stripComments`'s answer: comments are spaces there, so a
 * `//` inside a string is still a string and every comment is already
 * whitespace. What is left to do is trim.
 *
 * @param {String} commentless
 * @param {Number} from
 * @param {Number} to
 * @return {{from: Number, to: Number}} the empty span `{from, from}` when there
 * is no value at all
 */
const valueSpan = (commentless, from, to) => {
  let start = from

  while (start < to && /\s/.test(commentless[start])) {
    start++
  }

  let end = to

  while (end > start && /\s/.test(commentless[end - 1])) {
    end--
  }

  return {from: start, to: end}
}

/**
 * The value of a slice of the source, as the text a field holds.
 *
 * A string is the characters it holds; `true`, `false` and `null` are their own
 * words; a number is its digits; everything else — a call, a closure, an array
 * whose keys are not the form's — is the code it was written as, which is what
 * the field shows and what `writeFields` writes back unchanged.
 *
 * @param {String} source
 * @param {String} code stripped, at the same offsets
 * @param {Number} from
 * @param {Number} to
 * @return {{value: String, quoted: Boolean}}
 */
const valueText = (source, commentless, from, to) => {
  const span = valueSpan(commentless, from, to)

  if (span.from >= span.to) {
    return {value: '', literal: null}
  }

  const text = source.slice(span.from, span.to)

  // one literal and nothing else: a string
  if (text.length >= 2 && (text[0] === '\'' || text[0] === '"')) {
    const end = endOfString(text, 0)

    if (end === text.length) {
      const read = stringValue(text, 0, end)

      return {value: read === null ? text.trim() : read, literal: null}
    }
  }

  const trimmed = text.trim()

  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed)) {
    // the field shows the digits, and what it writes back is the number: a text
    // form that wrote `'3'` turned every number in a form into a string
    return {value: trimmed, literal: 'number'}
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return {value: trimmed.toLowerCase(), literal: 'boolean'}
  }

  if (/^null$/i.test(trimmed)) {
    return {value: '', literal: 'null'}
  }

  // a value this does not read as a literal — a call, an arithmetic expression,
  // a property — is code, and it is written back as the code it is
  return {value: trimmed, literal: 'code'}
}

/**
 * Where one `'key' => value` pair of an array ends: at the next `,` outside a
 * bracket and a string, or at the `]` that closes the array.
 *
 * A `;` ends nothing here — an array's pairs are separated by commas, and an
 * array written across lines has no `;` inside it at all. A string is skipped by
 * its own extent, so a `,` or a `]` that is part of a value stays a character.
 *
 * @param {String} commentless
 * @param {Number} from
 * @param {Number} to
 * @return {Number} the offset of the separator, or `to`
 */
const endOfEntry = (commentless, from, to) => {
  let depth = 0

  for (let at = from; at < to; at++) {
    const char = commentless[at]

    if (char === '\'' || char === '"') {
      at = endOfString(commentless, at) - 1
      continue
    }

    if (char === '[' || char === '(' || char === '{') {
      depth++
      continue
    }

    if (char === ']' || char === ')' || char === '}') {
      if (depth === 0) {
        return at
      }

      depth--
      continue
    }

    if (char === ',' && depth === 0) {
      return at
    }
  }

  return to
}

/**
 * The `'key' => value` pairs of an array whose keys are the form's own.
 *
 * `['label' => 'Email', 'value' => '…', 'type' => 'number']` declares a field;
 * the values are what the rows draw. Only string keys that mean something to the
 * form are read: an array of plain values (`[1, 2, 3]`) is a value, not a
 * declaration, and a `['label' => …]` in a value's own nested array is not read
 * either, because the pairs are taken at one level only.
 *
 * Everything here is read from the comment-free text, because a key is a string
 * and the stripped code has every string blanked. The statement's extent comes
 * from the stripped code, where every `;` is a statement end.
 *
 * @param {String} source
 * @param {String} code stripped
 * @param {String} commentless
 * @param {Number} from where the value starts
 * @param {Number} to where it ends
 * @return {Object|null} key => valueText of each declared key, or null when the
 * value is not such an array
 */
const declaredKeys = (source, code, commentless, from, to) => {
  const span = valueSpan(commentless, from, to)
  const opening = span.from

  // `[` … `]`, or the older `array(` … `)`
  let at = opening

  if (commentless[at] !== '[') {
    const call = /^array\s*\(/i.exec(commentless.slice(at, to))

    if (!call) {
      return null
    }

    at += call[0].length
  } else {
    at += 1
  }

  const keys = {}

  while (at < to) {
    const char = commentless[at]

    if (/[\s,]/.test(char)) {
      at++
      continue
    }

    // the array closes: the pairs are done
    if (char === ']' || char === ')') {
      break
    }

    // a key is a quoted string followed by `=>`, and a value this does not read
    // at the array's own level means this is not a declaration at all
    const key = /^('([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")\s*=>/.exec(commentless.slice(at, to))

    if (!key) {
      return null
    }

    const name = key[2] !== undefined ? key[2] : key[3]

    if (!declared.has(name)) {
      return null
    }

    const valueFrom = at + key[0].length
    const valueTo = endOfEntry(commentless, valueFrom, to)

    keys[name] = valueText(source, commentless, valueFrom, valueTo)

    // the separator is where the next pair starts
    at = valueTo < to ? valueTo + 1 : to
  }

  return Object.keys(keys).length ? keys : null
}

/**
 * The fields of a snippet: every top-level `$<prefix>name = …;` in it.
 *
 * @param {String} source the snippet's code
 * @param {String} [prefix] what a field's variable starts with after the `$`
 * @return {Array<Object>} the fields, in the order they appear, as
 * `{name, value, label?, type?, options?, description?}`
 */
const readForm = (source, prefix = 'form_') => {
  const text = String(source || '')
  const code = stripNonCode(text)
  const commentless = stripComments(text)
  const depths = depthsOf(code)
  const fields = []
  const seen = new Set()
  // a variable name is what php accepts, and `\x80-\xff` is not all of it: a
  // non-breaking space is U+00A0, which is in that byte range and is not a name
  // character — a snippet holding one between a name and its `=` used to give a
  // field called `$field_name ` and a write-back that broke the statement it
  // touched. php's rule, spelled out: ASCII letters, digits, `_` and the bytes
  // above `\xB0` that a multibyte character's own bytes are — never the spaces
  const assignment = /\$([A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)\s*=(?!=)/g

  let match

  while ((match = assignment.exec(code))) {
    const name = match[1]

    if (!name.startsWith(prefix) || name.length === prefix.length) {
      continue
    }

    // a function body, a class body and an array are not where a form's own
    // variables are; the top level is
    if (depths[match.index] !== 0) {
      continue
    }

    // a static or property declaration is not an assignment to a variable, and
    // `->field_x =` is not one either
    const before = code.slice(Math.max(0, match.index - 2), match.index)

    if (before === '->' || before === '::') {
      continue
    }

    if (seen.has(name)) {
      // the last assignment is the one the snippet runs with
      const at = fields.findIndex(field => field.name === `$${name}`)

      if (at !== -1) {
        fields.splice(at, 1)
      }
    }

    seen.add(name)

    const valueFrom = match.index + match[0].length
    const valueTo = endOfStatement(code, valueFrom)
    const keys = declaredKeys(text, code, commentless, valueFrom, valueTo)
    const read = keys && keys.value
      ? {value: keys.value.value, literal: keys.value.literal}
      : valueText(text, commentless, valueFrom, valueTo)

    const field = {name: `$${name.trim()}`, value: read.value}

    // a number written as one is written back as one, and a null is written as
    // `null` rather than as the empty string its field shows. It travels as
    // `literal` rather than as `type`, because `type` is what draws the row: a
    // field is not turned into a number input by having been a number
    if (read.literal) {
      field.literal = read.literal
    }

    if (keys) {
      for (const key of declared) {
        if (key === 'value' || !keys[key]) {
          continue
        }

        field[key] = keys[key].value

        // the options of a select are the array it was written as, so they come
        // back as the pairs they are
        if (key === 'options') {
          field.options = optionsOf(keys[key].value)
        }
      }
    }

    fields.push(field)
  }

  return fields
}

/**
 * A select's options, out of the source they were written as.
 *
 * `[['value' => 'a', 'label' => 'A'], …]` is the shape a field declares, and it
 * is read here rather than in the field's row, which draws what it is given.
 *
 * @param {String} source the declared text
 * @return {Array<{value: String, label: String}>|undefined}
 */
const optionsOf = source => {
  const pairs = []
  const entries = /\{[^}]*\}|\[[^\]]*\]/g

  for (const entry of String(source).match(entries) || []) {
    const value = /['"]value['"]\s*=>\s*(['"])([\s\S]*?)\1/.exec(entry)
    const label = /['"]label['"]\s*=>\s*(['"])([\s\S]*?)\1/.exec(entry)

    if (!value) {
      continue
    }

    pairs.push({value: value[2], label: label ? label[2] : value[2]})
  }

  return pairs.length ? pairs : undefined
}

/**
 * What a field's variable may be called: a name php accepts.
 *
 * @param {String} name
 * @return {Boolean}
 */
const isFieldName = name => namePattern.test(String(name || '').replace(/^\$/, ''))

module.exports = {
  readForm,
  isFieldName,
  endOfStatement,
}
