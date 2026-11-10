/**
 * The suggestion popup of a php snippet: the class names, members, locals,
 * attributes and string arguments the main process answered with.
 *
 * Monaco asks on every keystroke and drops the answer it is no longer waiting
 * for, so this does no work of its own: the class index, the intel read and the
 * snippet's own types live in the main process, which caches them (see
 * completion.js there), and a question already being asked is answered once.
 *
 * What is left here is the popup itself: which icon a row gets, how the rows are
 * ordered, what a row inserts, and the `use` line a class name needs. That last
 * rule runs in the main process too, for the session's own imports
 * (tinkr-core/src/classIndex.js `importEditAt`), and the renderer cannot import
 * core — the bundle has no node, and core's module graph reaches `node-pty`. So
 * the rule is written twice, the way utils/containerCommand.js is, and the test
 * that compares the two is what keeps them from drifting.
 *
 * `php-snippet` has its own inline completion provider — the AI ghost text —
 * and the two are separate providers: this one never touches that one.
 */

// what opens the popup: the second colon of a `::`, the `>` of a `->`, a
// namespace separator while a class name is being spelled out, the quote that
// starts a config key, route name, view, env key, translation key or binding,
// and the `$` that starts a variable
const triggerCharacters = [':', '>', '\\', "'", '"', '$']

// how many rows the popup is given: the main process ranks its answers into
// groups, and anything past this is not a suggestion but a list
const limit = 200

/**
 * The icon a row gets. Monaco has no kind for a trait, a relation or a scope, so
 * those borrow the closest one rather than all looking like a class: a trait is
 * a module of methods, a relation is a reference to another model, and a scope
 * is a method written by hand.
 *
 * @param {String} type what the main process says the answer is
 * @param {Object} kinds monaco's CompletionItemKind
 * @return {Number}
 */
const kindOf = (type, kinds) => {
  const kind = {
    class: kinds.Class,
    interface: kinds.Interface,
    trait: kinds.Module,
    enum: kinds.Enum,
    function: kinds.Function,
    method: kinds.Method,
    property: kinds.Property,
    attribute: kinds.Field,
    relation: kinds.Reference,
    scope: kinds.Method,
    constant: kinds.Constant,
    variable: kinds.Variable,
    keyword: kinds.Keyword,
    value: kinds.Value,
  }[type]

  // `method` and `scope` are monaco's `Method`, which is 0, so the answer is
  // checked for rather than defaulted with `||`
  return kind === undefined ? kinds.Text : kind
}

/**
 * Where a row sits: the main process ranks its answers into groups (attributes
 * and relations before locals, the project's own classes before the vendor's,
 * and keywords last), a `rank` puts the members of one group in the order they
 * were read — a model's columns in the order of its table — and the label breaks
 * what is left of the tie, so the same prefix always shows the same order.
 *
 * @param {Object} item
 * @return {String}
 */
const sortTextOf = item => `${item.sort === undefined || item.sort === null ? '3' : item.sort}${item.rank || ''}${item.label}`

// one past a string's closing quote, escapes included; an open string ends with
// the snippet
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

  return source.length
}

// one past the closing label of a heredoc or nowdoc (`<<<EOT`)
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

  // php 7.3 lets the closing label be indented, and it closes the string only
  // when nothing else follows it on the line
  const closing = new RegExp(`^[ \\t]*${label}(?![A-Za-z0-9_])`, 'm').exec(source.slice(body + 1))

  return closing ? body + 1 + closing.index + closing[0].length : source.length
}

const endOfLine = (source, start) => {
  const end = source.indexOf('\n', start)

  return end === -1 ? source.length : end
}

/**
 * The snippet with its strings, heredocs and comments blanked, offsets kept: a
 * `use` line is then read out of code and not out of a string about code.
 *
 * @param {String} source
 * @return {String}
 */
const strip = source => {
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
    let end = -1

    if (char === "'" || char === '"' || char === '`') {
      end = endOfQuoted(source, i)
    } else if (char === '/' && source[i + 1] === '/') {
      end = endOfLine(source, i)
    } else if (char === '#' && source[i + 1] !== '[') {
      // `#[` opens an attribute, only a bare `#` comments the rest of the line
      end = endOfLine(source, i)
    } else if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)

      end = close === -1 ? source.length : close + 2
    } else if (source.startsWith('<<<', i)) {
      end = endOfHeredoc(source, i)
    }

    if (end === -1) {
      i++
      continue
    }

    blank(i, Math.max(end, i + 1))
    i = Math.max(end, i + 1)
  }

  return out.join('')
}

// the comma separated pieces of what a `use` statement imports, with a group
// use's own commas left inside its braces: `App\{Order, User as U}, Other\X` is
// three pieces
const piecesOf = value => {
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

const nameStart = '[A-Za-z_\\x80-\\xff]'
const namePart = '[A-Za-z0-9_\\x80-\\xff]'

/**
 * The classes a snippet's `use` statements bring into scope, by the name it makes
 * them answer to.
 *
 * @param {String} stripped the snippet with its strings and comments blanked
 * @return {Map<String, String>} lowercased name in scope => fully qualified name
 */
const importsOf = stripped => {
  const imports = new Map()
  const statements = /\buse\s+(?:(function|const)\s+)?([^;()]+);/gi

  let statement

  while ((statement = statements.exec(stripped))) {
    if (statement[1]) {
      continue
    }

    for (const piece of piecesOf(statement[2])) {
      const brace = piece.indexOf('{')
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

        imports.set((alias || last).trim().toLowerCase(), named)
      }
    }
  }

  return imports
}

// the offset a line of its own starts at, when the offset it is asked about is
// the end of a line
const lineAfter = (code, at) => {
  const match = /^[ \t]*\r?\n/.exec(code.slice(at))

  return match ? at + match[0].length : at
}

// the offset of the `;` that ends the last `use` the snippet declares at the top
// level, or -1 when it declares none: a trait's `use` is inside a class body and
// a closure's `use ($x)` closes over variables, and neither imports a class
const lastUseEnd = stripped => {
  let depth = 0
  let end = -1
  let offset = 0

  for (const line of stripped.split('\n')) {
    const start = offset
    offset += line.length + 1

    if (depth === 0 && /^[ \t]*use\s+/.test(line)) {
      const isStatement = /^[ \t]*use\s+(\(|function\s|const\s)/.test(line) === false
      const semicolon = stripped.indexOf(';', start)

      if (isStatement && semicolon !== -1) {
        end = semicolon
      }
    }

    for (const char of line) {
      if (char === '{') {
        depth++
      } else if (char === '}') {
        depth = Math.max(0, depth - 1)
      }
    }
  }

  return end
}

/**
 * The `use` line a class name needs, if it needs one — the same rule as
 * tinkr-core's `importEditAt`, which is what the session aliases a snippet with:
 * a class that is not imported, aliased or of the snippet's own namespace is
 * imported after the last `use` of the snippet, or after its opening tag.
 *
 * @param {String} code the snippet, as the editor holds it
 * @param {String} fqcn the class the row inserts
 * @return {{offset: Number, text: String}|null}
 */
export const importEditAt = (code, fqcn) => {
  const name = String(fqcn == null ? '' : fqcn).replace(/^\\+/, '').trim()

  // a global class (`DateTime`, `Exception`) resolves on its own name
  if (!name.includes('\\')) {
    return null
  }

  const stripped = strip(code)
  const imports = importsOf(stripped)
  const lower = name.toLowerCase()
  const short = name.split('\\').pop()

  for (const imported of imports.values()) {
    // `use App\Models\User as U;` already answers for the class
    if (imported.toLowerCase() === lower) {
      return null
    }
  }

  // another class already answers to this short name, and a second `use` of one
  // is a fatal error
  if (imports.has(short.toLowerCase())) {
    return null
  }

  const namespace = /^[ \t]*namespace\s+([\\\w\x80-\xff]+)\s*;/m.exec(stripped)

  if (namespace && lower.startsWith(`${namespace[1].replace(/^\\+/, '').toLowerCase()}\\`)) {
    return null
  }

  const end = lastUseEnd(stripped)
  const tag = /^[ \t]*<\?php/.exec(code)
  const at = end !== -1 ? lineAfter(code, end + 1) : (tag ? lineAfter(code, tag[0].length) : 0)
  const line = code.includes('\r\n') ? '\r\n' : '\n'
  const statement = `use ${name};${line}`

  return {offset: at, text: at > 0 && code[at - 1] !== '\n' ? `${line}${statement}` : statement}
}

/**
 * @param {Object} item what the main process answered with
 * @param {Object} context `kinds`, `insertAsSnippet`, the snippet's `code`, and
 * `positionAt` from the model
 * @return {Object} a monaco completion item
 */
export const toMonacoItem = (item, context) => {
  const {kinds, insertAsSnippet, code, positionAt} = context
  const row = {
    label: item.label,
    kind: kindOf(item.type, kinds),
    // what monaco filters the list on while the name is being typed: the member
    // or class name, without the signature it is shown with
    filterText: item.filter === undefined || item.filter === null ? item.label : item.filter,
    sortText: sortTextOf(item),
    insertText: item.insert === undefined || item.insert === null ? item.label : item.insert,
  }

  if (item.snippet) {
    row.insertTextRules = insertAsSnippet
  }

  if (item.detail) {
    row.detail = item.detail
  }

  if (item.documentation) {
    // markdown, and not trusted: a docblock is the project's text, not ours to
    // render html out of
    row.documentation = {value: item.documentation, isTrusted: false}
  }

  // a string argument holds a name with dots and separators in it, which monaco's
  // word boundaries break at: the answer replaces what was typed since the quote,
  // and the main process is the one that knows where the quote is
  if (typeof item.from === 'number') {
    const start = positionAt(item.from)
    const end = positionAt(typeof item.to === 'number' ? item.to : item.from)

    row.range = {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    }
  }

  const edit = item.import ? importEditAt(code, item.import) : null

  if (edit) {
    // a `use` line is inserted at an offset, which is an empty range there
    const at = positionAt(edit.offset)

    row.additionalTextEdits = [{
      range: {
        startLineNumber: at.lineNumber,
        startColumn: at.column,
        endLineNumber: at.lineNumber,
        endColumn: at.column,
      },
      text: edit.text,
    }]
  }

  return row
}

/**
 * The rows the popup is shown: deduped, ranked, and capped.
 *
 * The same class reached two ways (`User` twice, once as the model and once as
 * the builder's target) is one row; the ranking is the main process's own
 * grouping, so the popup never has to reorder what it was given beyond that; and
 * the list stops at `limit`, since a popup nobody can read is not a suggestion.
 *
 * @param {Array<Object>} items
 * @param {Object} context
 * @return {Array<Object>}
 */
export const toMonacoItems = (items, context) => {
  const seen = new Set()
  const rows = []

  for (const item of items) {
    const key = `${item.label}\u0000${item.detail || ''}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    rows.push(toMonacoItem(item, context))
  }

  rows.sort((a, b) => (a.sortText < b.sortText ? -1 : (a.sortText > b.sortText ? 1 : 0)))

  return rows.slice(0, limit)
}

/**
 * @param {monaco} monaco
 * @param {Function} ask the connection's completion call
 * @return {Object} a monaco completion item provider
 */
export const createCompletionProvider = (monaco, ask) => ({
  triggerCharacters,

  provideCompletionItems: async (model, position, context, token) => {
    const offset = model.getOffsetAt(position)
    // the whole snippet goes, not a window before the caret: the type of a name
    // is what the snippet assigned to it higher up, and an import belongs with
    // the snippet's `use` lines, both of which a window would cut away
    const code = model.getValue()

    let answer

    try {
      answer = await ask({code, offset, triggerCharacter: context.triggerCharacter})
    } catch (e) {
      // a suggestion is never worth an error where someone is typing
      return {suggestions: []}
    }

    if (token.isCancellationRequested || !answer) {
      return {suggestions: []}
    }

    const list = {
      suggestions: toMonacoItems(answer.items || [], {
        kinds: monaco.languages.CompletionItemKind,
        insertAsSnippet: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        code,
        positionAt: at => model.getPositionAt(at),
      }),
    }

    // a list answered before the read that fills it was done says so, and monaco
    // asks again on the next keystroke instead of holding the rows it has
    if (answer.incomplete === true) {
      list.incomplete = true
    }

    return list
  },
})

/**
 * @param {monaco} monaco
 * @param {Function} ask
 * @return {monaco.IDisposable}
 */
export const registerPHPCompletionProvider = (monaco, ask) =>
  monaco.languages.registerCompletionItemProvider('php-snippet', createCompletionProvider(monaco, ask))
