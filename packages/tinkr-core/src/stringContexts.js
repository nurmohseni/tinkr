/**
 * The string a snippet's caret is inside, when that string is the argument of a
 * call that takes a name: a config key, a route name, a view, an env key, a
 * translation key, a container binding.
 *
 * It answers from the snippet alone — no php, no session, no project — and it
 * runs on every keystroke, so it is a scan of the text and nothing else. What
 * the popup then holds is the intel read's business: this only says which list
 * is being typed into, and from where.
 *
 * A string that is not a call's first argument is not a context: `str_replace('a',
 * 'b`, a second argument (`config('a', 'b`), a heredoc body, a comment, and a
 * name written in quotes (`'Teatro::wh'`) are all nothing. A wrong list is worse
 * than none.
 */

const {stripNonCode} = require('./phpScanner')

// one past the closing quote of a string, escapes included, or -1 when the
// snippet ends while the string is still open
const endOfQuoted = (source, start) => {
  const quote = source[start]
  let i = start + 1

  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }

    if (source[i] === quote) {
      return i + 1
    }

    i++
  }

  return -1
}

// one past the closing label of a heredoc or nowdoc (`<<<EOT`), whose body holds
// quotes that are text rather than the start of a string
const endOfHeredoc = (source, start) => {
  const header = /^<<<[ \t]*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/.exec(source.slice(start))

  if (!header) {
    return start + 3
  }

  const label = header[1] || header[2] || header[3]
  const body = source.indexOf('\n', start + header[0].length)

  // the label's line is the last one the snippet has: nothing closes it
  if (body === -1) {
    return -1
  }

  // php 7.3 lets the closing label be indented, and it closes the string only
  // when nothing else follows it on the line
  const closing = new RegExp(`^[ \\t]*${label}(?![A-Za-z0-9_])`, 'm').exec(source.slice(body + 1))

  return closing ? body + 1 + closing.index + closing[0].length : -1
}

const endOfLine = (source, start) => {
  const end = source.indexOf('\n', start)

  return end === -1 ? source.length : end
}

/**
 * The string the offset is inside, if it is inside one.
 *
 * The scan is what keeps `config('// x` from being read as a comment and `'it\'s`
 * from being read as two strings: quotes, heredocs and comments are stepped over
 * whole, and the offset is looked at only between them.
 *
 * @param {String} source
 * @param {Number} offset
 * @return {{quote: Number, start: Number}|null} the opening quote, and the first
 * character of the string's content
 */
const stringAt = (source, offset) => {
  let i = 0

  while (i < offset) {
    const char = source[i]

    if (char === "'" || char === '"' || char === '`') {
      const end = endOfQuoted(source, i)

      // a string that is still open when the snippet ends holds the caret
      if (end === -1 || offset < end) {
        return {quote: i, start: i + 1}
      }

      i = end
      continue
    }

    if (char === '<' && source.startsWith('<<<', i)) {
      const end = endOfHeredoc(source, i)

      // an unclosed heredoc runs to the end of the snippet, and it holds the caret
      if (end === -1 || offset < end) {
        return null
      }

      i = end
      continue
    }

    if (char === '/' && source[i + 1] === '/') {
      const end = endOfLine(source, i)

      if (offset <= end) {
        return null
      }

      i = end
      continue
    }

    // `#[` opens an attribute, and every other hash starts a comment
    if (char === '#' && source[i + 1] !== '[') {
      const end = endOfLine(source, i)

      if (offset <= end) {
        return null
      }

      i = end
      continue
    }

    if (char === '/' && source[i + 1] === '*') {
      const closing = source.indexOf('*/', i + 2)
      const end = closing === -1 ? source.length : closing + 2

      if (offset < end) {
        return null
      }

      i = end
      continue
    }

    i++
  }

  return null
}

// a function whose first string argument is a name, by the name written: php
// resolves a function without regard to case, and a name may be qualified
const functionKinds = {
  config: 'config',
  route: 'route',
  view: 'view',
  env: 'env',
  trans: 'trans',
  trans_choice: 'trans',
  __: 'trans',
  app: 'binding',
  resolve: 'binding',
}

// the same, for the calls written on a facade or on a helper's answer: the
// class is what makes `Config::get` a config key and `Cache::get` a cache key
const staticKinds = {
  'config::get': 'config',
  'view::make': 'view',
  'url::route': 'route',
  'route::has': 'route',
  'lang::get': 'trans',
  'app::make': 'binding',
}

const memberKinds = {
  route: 'route',
  make: 'binding',
}

const shortOf = name => name.split('\\').pop().toLowerCase()

/**
 * @param {String} written the call's name before its parenthesis
 * @return {String|null}
 */
const kindOfCall = written => {
  // `Config::get(`: the class first, because its own name ends a word too
  const onClass = /([\\A-Za-z_\x80-\xff][\\\w\x80-\xff]*)\s*::\s*([A-Za-z_\x80-\xff][\w\x80-\xff]*)\s*$/.exec(written)

  if (onClass) {
    return staticKinds[`${shortOf(onClass[1])}::${onClass[2].toLowerCase()}`] || null
  }

  const onObject = /(?:->|\?->)\s*([A-Za-z_\x80-\xff][\w\x80-\xff]*)\s*$/.exec(written)

  if (onObject) {
    return memberKinds[onObject[1].toLowerCase()] || null
  }

  const onFunction = /([\\A-Za-z_\x80-\xff][\\\w\x80-\xff]*)\s*$/.exec(written)

  // `$config(` calls whatever the variable holds, which is not the function of
  // that name
  if (onFunction && written[onFunction.index - 1] !== '$') {
    return functionKinds[shortOf(onFunction[1])] || null
  }

  return null
}

/**
 * @param {String} source
 * @param {Number} quote the string's opening quote
 * @return {String|null} the kind of name the string holds
 */
const kindOfString = (source, quote) => {
  // strings and comments before the quote are blanked, so a call name is what
  // is read, and an offset is still an offset
  const before = stripNonCode(source.slice(0, quote))
  const paren = before.lastIndexOf('(')

  // the string has to be the first thing the call is given: `config('a',
  // 'b` holds a second argument, and a key is not what it says
  if (paren === -1 || before.slice(paren + 1).trim() !== '') {
    return null
  }

  return kindOfCall(before.slice(0, paren))
}

/**
 * What the string at the offset is the name of.
 *
 * @param {String} code the snippet, as the editor holds it
 * @param {Number} offset the caret's offset in it
 * @return {{kind: String, prefix: String, start: Number}|null} the list the
 * popup shows, what has been typed of the name, and the offset the string's
 * content starts at — which is where the answer replaces what is there
 */
const stringContextAt = (code, offset) => {
  if (typeof code !== 'string') {
    return null
  }

  const at = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, code.length))
  const string = stringAt(code, at)

  if (!string) {
    return null
  }

  const kind = kindOfString(code, string.quote)

  return kind ? {kind, prefix: code.slice(string.start, at), start: string.start} : null
}

module.exports = {stringContextAt}
