/**
 * What a snippet asks the session for by name.
 *
 * A snippet is written for a scratchpad, not for a file: `Order::where('paid',
 * true)->count()` is what someone types, with no `use App\Models\Order;` above
 * it. So the names in class position are read out of the text here, and the
 * classes they stand for are aliased into the session before it runs (see
 * runResult.wrapRun). A `use` the snippet does write is kept by the wrapper
 * itself, and is not aliased here.
 *
 * This is a targeted scan rather than a parser. It blanks everything that is
 * not code first — strings, heredocs, comments — with a small state machine, so
 * a `'Order'` or a `// Order::where` can never be read as a class, and then it
 * looks at the identifiers that sit in a place php resolves as a class.
 */

// php's own words: `array $x` and `self::` are identifiers too, and no project
// declares them
const keywords = new Set([
  'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch',
  'class', 'clone', 'const', 'continue', 'declare', 'default', 'die', 'do',
  'echo', 'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach',
  'endif', 'endswitch', 'endwhile', 'enum', 'eval', 'exit', 'extends', 'final',
  'finally', 'fn', 'for', 'foreach', 'from', 'function', 'global', 'goto', 'if',
  'implements', 'include', 'include_once', 'instanceof', 'insteadof',
  'interface', 'isset', 'iterable', 'list', 'match', 'mixed', 'namespace',
  'never', 'new', 'null', 'object', 'or', 'parent', 'print', 'private',
  'protected', 'public', 'readonly', 'require', 'require_once', 'return',
  'self', 'static', 'string', 'int', 'float', 'bool', 'true', 'false', 'switch',
  'throw', 'trait', 'try', 'unset', 'use', 'var', 'void', 'while', 'xor',
  'yield',
])

const nameStart = '[A-Za-z_\\x80-\\xff]'
const namePart = '[A-Za-z0-9_\\x80-\\xff]'

// a name token is a qualified name (`App\Models\Order`), a bare one (`Order`)
// or a variable (`$order`); anything else is one symbol at a time, and
// whitespace is not a token at all
const tokens = new RegExp(
  `\\$(?<var>${nameStart}${namePart}*)` +
  `|(?<name>\\\\?${nameStart}${namePart}*(?:\\\\${nameStart}${namePart}*)*)` +
  '|(?<symbol>->|\\?->|::|[^\\s])',
  'g',
)

/**
 * The index of the end of a quoted string, escaped characters included.
 *
 * @param {String} source
 * @param {Number} start at the opening quote
 * @return {Number} one past the closing quote, or the end of the source
 */
const endOfString = (source, start) => {
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

  return source.length
}

/**
 * The index of the end of a heredoc or nowdoc, label line included.
 *
 * @param {String} source
 * @param {Number} start at `<<<`
 * @return {Number}
 */
const endOfHeredoc = (source, start) => {
  const header = /^<<<[ \t]*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/.exec(source.slice(start))

  if (!header) {
    return start + 3
  }

  const label = header[1] || header[2] || header[3]
  const body = source.indexOf('\n', start + header[0].length)

  if (body === -1) {
    return source.length
  }

  // php 7.3 lets the closing label be indented, and it ends the string only
  // when nothing else follows it on the line
  const closing = new RegExp(`^[ \\t]*${label}(?![A-Za-z0-9_])`, 'm').exec(source.slice(body + 1))

  if (!closing) {
    return source.length
  }

  return body + 1 + closing.index + closing[0].length
}

const endOfLine = (source, start) => {
  const end = source.indexOf('\n', start)

  return end === -1 ? source.length : end
}

/**
 * The same source with every string, heredoc and comment replaced by spaces.
 *
 * Length and line breaks are kept, so a position in the result is a position in
 * the snippet. Nothing is joined together either: `'Order'::x` blanks to
 * `       ::x`, which is not a name.
 *
 * @param {String} source
 * @return {String}
 */
const stripNonCode = source => {
  const out = source.split('')
  const blank = (from, to) => {
    for (let i = from; i < to; i++) {
      if (out[i] !== '\n' && out[i] !== '\r') {
        out[i] = ' '
      }
    }
  }

  let i = 0

  while (i < source.length) {
    const char = source[i]

    if (char === "'" || char === '"' || char === '`') {
      const end = endOfString(source, i)

      blank(i, end)
      i = end
      continue
    }

    if (char === '/' && source[i + 1] === '/') {
      const end = endOfLine(source, i)

      blank(i, end)
      i = end
      continue
    }

    // `#[` opens an attribute, only a bare `#` comments the rest of the line
    if (char === '#' && source[i + 1] !== '[') {
      const end = endOfLine(source, i)

      blank(i, end)
      i = end
      continue
    }

    if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      const end = close === -1 ? source.length : close + 2

      blank(i, end)
      i = end
      continue
    }

    if (source.startsWith('<<<', i)) {
      const end = endOfHeredoc(source, i)

      blank(i, end)
      i = end
      continue
    }

    i++
  }

  return out.join('')
}

/**
 * The comma separated pieces of what a `use` statement imports, with a group
 * use's own commas left inside its braces: `App\{Order, User as U}, Other\X` is
 * three pieces.
 *
 * @param {String} value
 * @return {Array<String>}
 */
const usePieces = value => {
  const pieces = []
  let depth = 0
  let piece = ''

  for (const char of value) {
    if (char === '{') {
      depth++
    }

    if (char === '}') {
      depth--
    }

    // a group use holds its own commas, and they do not separate the imports
    if (char === ',' && depth === 0) {
      pieces.push(piece)
      piece = ''
      continue
    }

    piece += char
  }

  pieces.push(piece)

  return pieces
}

/**
 * The classes a `use` statement in the snippet brings into scope, by the name
 * it makes them answer to.
 *
 * `use function` and `use const` import no class and are dropped. A group use
 * writes the shared prefix once outside the braces, so `use App\Models\{Order,
 * User as U};` is two classes and not two names.
 *
 * @param {String} source stripped
 * @return {Map<String, String>} lowercased name in scope => fully qualified name
 * (`Order` and `order` are one name to php, and so are their aliases)
 */
const importedClasses = source => {
  const classes = new Map()
  const statements = /\buse\s+(?:(function|const)\s+)?([^;()]+);/gi

  let statement

  while ((statement = statements.exec(source))) {
    if (statement[1]) {
      continue
    }

    for (const piece of usePieces(statement[2])) {
      const brace = piece.indexOf('{')
      // `use App\Models\{Order}, Other\{Helper};` writes the prefix of each group
      // outside its braces, and only the first of them has no space before it
      const prefix = brace === -1 ? '' : piece.slice(0, brace).trim()
      const names = brace === -1
        ? [piece]
        : piece.slice(brace + 1, piece.lastIndexOf('}')).split(',')

      for (const name of names) {
        const imported = name.trim()

        // `use App\{function make};` imports a function, not a class
        if (!imported || /^(function|const)\s/.test(imported)) {
          continue
        }

        const [qualified, alias] = imported.split(/\s+as\s+/i)
        const named = `${prefix}${qualified.trim()}`.replace(/^\\+/, '')
        const last = named.split('\\').pop()

        if (!new RegExp(`^${nameStart}${namePart}*$`).test(last)) {
          continue
        }

        classes.set((alias || last).trim().toLowerCase(), named)
      }
    }
  }

  return classes
}

/**
 * The names a `use` statement in the snippet already brings into scope.
 *
 * They resolve on their own, and aliasing them would be work done over a name
 * the snippet has already answered for itself.
 *
 * @param {String} source stripped
 * @return {Set<String>} lowercased
 */
const importedNames = source => new Set(importedClasses(source).keys())

/**
 * @param {Array<{type: String, text: String}>} list
 * @param {Number} at a name token
 * @return {Boolean} whether the names after it are a type declaration
 * (`Order $x`, `Order|Other $e`), which is what a parameter, a catch and a
 * property type are written as
 */
const beforeVariable = (list, at) => {
  let i = at + 1

  while (list[i] && (list[i].text === '|' || list[i].text === '&') && list[i + 1] && list[i + 1].type === 'name') {
    i += 2
  }

  return Boolean(list[i]) && list[i].type === 'var'
}

/**
 * The bare class names the snippet uses.
 *
 * A name counts when php would resolve it as a class:
 *
 *   Order::where(…)   Order::class   new Order   Order $x   instanceof Order
 *
 * and it does not when it is already qualified (`\Order`, `App\Models\Order`),
 * a variable (`$order`), a member (`->order`, `Order::where`), a function
 * (`config(…)`, `dump(…)`), a string, a comment, a keyword (`self::`, `array $x`)
 * or a name the snippet's own `use` statement covers.
 *
 * @param {String} source
 * @return {Array<String>} sorted, so a run reports the same order every time
 */
const bareClassNames = source => {
  const stripped = stripNonCode(source)
  const imported = importedNames(stripped)
  const list = []

  let match

  tokens.lastIndex = 0

  while ((match = tokens.exec(stripped))) {
    list.push({
      type: match.groups.var ? 'var' : (match.groups.name ? 'name' : 'symbol'),
      text: match[0],
    })
  }

  const names = new Set()

  list.forEach((token, at) => {
    if (token.type !== 'name') {
      return
    }

    const previous = list[at - 1]
    const next = list[at + 1]
    const followsNew = previous && previous.type === 'name' && previous.text.toLowerCase() === 'new'
    const followsInstanceof = previous && previous.type === 'name' && previous.text.toLowerCase() === 'instanceof'
    const staticAccess = next && next.text === '::'

    if (!staticAccess && !followsNew && !followsInstanceof && !beforeVariable(list, at)) {
      return
    }

    // `\Order` and `App\Models\Order` already say where the class is
    if (token.text.includes('\\')) {
      return
    }

    if (/^__.*__$/.test(token.text)) {
      return
    }

    // php resolves a name without regard to case, and so does a `use` statement
    if (keywords.has(token.text.toLowerCase()) || imported.has(token.text.toLowerCase())) {
      return
    }

    names.add(token.text)
  })

  return Array.from(names).sort()
}

module.exports = {
  stripNonCode,
  importedClasses,
  bareClassNames,
}
