/**
 * Values that must not leave the screen, hidden where they are written down.
 *
 * A run is the person's own work, and the app shows it to them in full. What it
 * keeps on disk, what it sends to an AI provider and what it hands an MCP
 * client are different readers, and a password that came back from an Eloquent
 * model has no business reaching any of them. So a value is hidden by its key,
 * at any depth: an Eloquent model's attributes, a row, a request payload, a dry
 * run's before and after. `[hidden]` is what is left in its place, so a reader can
 * tell a hidden field from a missing one.
 *
 * The list of fields is the person's: the names below are the ones a project
 * hands back by default. A field is paired with its query binding only where
 * the SQL says which column a placeholder belonged to — see `redactQuery` — so
 * this is best effort, not a guarantee that no secret is ever in a binding.
 */

const HIDDEN = '[hidden]'

/**
 * The field names hidden until somebody says otherwise.
 *
 * The wildcards are what make this list short: `*token*` is `remember_token`,
 * `access_token` and `token`, `*_key` is `api_key` and `private_key`, and
 * `*secret*` is `client_secret`. `key` alone is left out: it is an ordinary
 * column name, and hiding every one of them would hide more than it protects.
 *
 * @type {Array<String>}
 */
const defaultRedactFields = [
  '*password*',
  '*token*',
  '*secret*',
  'api_key',
  '*_key',
  '*authorization*',
  'cookie',
]

/**
 * A pattern, as the regexp that matches a whole field name with it.
 *
 * `*` matches any run of characters and nothing else is special: a pattern is
 * a field name with wildcards, not a regular expression somebody has to get
 * right. Case does not matter, because a column's case is its database's.
 *
 * @param {String} pattern
 * @return {RegExp}
 */
const patternOf = pattern => new RegExp(`^${pattern
  .split('*')
  .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('.*')}$`, 'i')

/**
 * The fields a setting names, as the patterns that match them.
 *
 * A setting nobody has touched reads as the defaults, and an empty list is a
 * list of no patterns: it hides nothing, and that is a choice the person made
 * rather than a setting that was never read.
 *
 * @param {any} fields the setting's value: field names with `*` wildcards
 * @return {Array<RegExp>}
 */
const redactPatterns = fields => {
  const listed = typeof fields === 'string'
    ? fields.split(/[\n,]/)
    : (Array.isArray(fields) ? fields : defaultRedactFields)
  const seen = new Set()
  const patterns = []

  for (const field of listed) {
    if (typeof field !== 'string' && typeof field !== 'number') {
      continue
    }

    const name = String(field).trim().toLowerCase()

    if (name === '' || seen.has(name)) {
      continue
    }

    seen.add(name)
    patterns.push(patternOf(name))
  }

  return patterns
}

/**
 * @param {String} key
 * @param {Array<RegExp>} patterns
 * @return {Boolean}
 */
const hiddenKey = (key, patterns) => patterns.some(pattern => pattern.test(key))

/**
 * A value with every field it holds, at any depth, hidden where its name says
 * so. Arrays keep their length — an array of models is a list of models — and
 * a field whose value is an object or a list is replaced whole.
 *
 * @param {any} value
 * @param {any} fields see `redactPatterns`
 * @return {any} the same value when nothing is hidden
 */
const redactValue = (value, fields) => {
  const patterns = redactPatterns(fields)

  if (patterns.length === 0 || value === null || typeof value !== 'object') {
    return value
  }

  return walk(value, key => hiddenKey(key, patterns))
}

/**
 * @param {any} value
 * @param {function(String): Boolean} hidden
 * @return {any}
 */
const walk = (value, hidden) => {
  if (Array.isArray(value)) {
    return value.map(item => walk(item, hidden))
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const copy = {}

  for (const key of Object.keys(value)) {
    copy[key] = hidden(key) ? HIDDEN : walk(value[key], hidden)
  }

  return copy
}

/**
 * Where each placeholder of a statement sits, and the SQL with its string
 * literals blanked so the words inside one are not read as SQL.
 *
 * Blanking keeps every character in place, so a match found in the blanked
 * SQL points at the same character of the statement.
 *
 * @param {String} sql
 * @return {{positions: Array<Number>, code: String}}
 */
const placeholdersOf = sql => {
  const chars = sql.split('')
  const positions = []
  let quote = null

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]

    if (quote) {
      if (char === quote) {
        if (sql[i + 1] === quote) {
          // a doubled quote is the quote itself, not the end of the literal
          chars[i + 1] = ' '
          i++

          continue
        }

        quote = null

        continue
      }

      // a backslash escapes the next character in a mysql or postgres literal;
      // it does not in a quoted identifier, where a doubled quote is the only
      // escape
      if (char === '\\' && quote !== '`') {
        chars[i] = ' '

        if (i + 1 < sql.length) {
          chars[i + 1] = ' '
          i++
        }

        continue
      }

      chars[i] = ' '

      continue
    }

    if (char === '\'' || char === '"') {
      quote = char

      continue
    }

    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)

      for (let j = i; j < (end === -1 ? sql.length : end); j++) {
        chars[j] = ' '
      }

      i = end === -1 ? sql.length : end

      continue
    }

    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)

      for (let j = i; j < (end === -1 ? sql.length : end + 2); j++) {
        chars[j] = ' '
      }

      i = end === -1 ? sql.length : end + 1

      continue
    }

    if (char === '?') {
      positions.push(i)
    }
  }

  return {positions, code: chars.join('')}
}

/**
 * A column name as SQL writes it: whatever quotes it, and whatever table it is
 * qualified with, is not part of the name.
 *
 * @param {String} text
 * @return {String}
 */
const columnOf = text => String(text)
  .replace(/`/g, '')
  .replace(/"/g, '')
  .split('.')
  .pop()
  .trim()

/**
 * One row of an `insert`'s values, paired expression by expression.
 *
 * @param {String} code the blanked SQL
 * @param {Array<Number>} positions every placeholder position, in statement order
 * @param {Array<String>} names the column list
 * @param {Number} from the character after the row's `(`
 * @param {Number} to the row's `)`
 * @return {Map<Number, String>} placeholder index => column
 */
const pairRow = (code, positions, names, from, to) => {
  const paired = new Map()
  const segments = []
  let depth = 0
  let start = from

  for (let at = from; at < to; at++) {
    const char = code[at]

    if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
    } else if (char === ',' && depth === 0) {
      segments.push([start, at])
      start = at + 1
    }
  }

  segments.push([start, to])

  segments.forEach(([begin, end], order) => {
    const found = positions.filter(position => position >= begin && position < end)

    // an expression holding more than one placeholder is a function of several
    // values, and there is no one column it belongs to
    if (found.length === 1 && names.length) {
      setIfAbsent(paired, positions.indexOf(found[0]), names[order % names.length])
    }
  })

  return paired
}

/**
 * The columns of an `insert`'s column list, as the values clause fills them.
 *
 * @param {String} code the blanked SQL
 * @param {Array<Number>} positions placeholder positions
 * @return {Map<Number, String>} placeholder index => column
 */
const insertColumns = (code, positions) => {
  const columns = new Map()
  const insert = /(?:^|[;\s])insert\s+(?:or\s+\w+\s+)?(?:ignore\s+)?into\s+[^\s(]+\s*\(([^)]*)\)\s*values\s*/gi
  let match = insert.exec(code)

  while (match) {
    const names = match[1].split(',').map(columnOf).filter(Boolean)

    // the groups after `values`: one row each, every row filled by the same
    // column list in the same order. A column is paired by its place among the
    // row's value expressions, not by counting placeholders: `values ('a', ?)`
    // fills the second column with a placeholder and the first with a literal
    let at = match.index + match[0].length
    let opening = -1
    let depth = 0

    for (; at < code.length; at++) {
      const char = code[at]

      if (char === '(') {
        if (depth === 0) {
          opening = at + 1
        }

        depth++
      } else if (char === ')' && depth > 0) {
        depth--

        if (depth === 0 && opening !== -1) {
          pairRow(code, positions, names, opening, at).forEach((column, index) => {
            setIfAbsent(columns, index, column)
          })
          opening = -1
        }
      } else if (depth === 0 && char !== ',' && !/\s/.test(char)) {
        // something other than another row follows the values: `returning`,
        // `on conflict`, the end of the statement
        break
      }
    }

    match = insert.exec(code)
  }

  return columns
}

/**
 * The column each placeholder compares against, where the statement says so:
 * `where password = ?`, `set token = ?`, and `where id in (?, ?)`.
 *
 * @param {String} code the blanked SQL
 * @param {Array<Number>} positions placeholder positions
 * @return {Map<Number, String>} placeholder index => column
 */
const comparedColumns = (code, positions) => {
  const columns = new Map()
  const comparison = /(`?[A-Za-z_][\w$]*`?(?:\s*\.\s*`?[A-Za-z_][\w$]*`?)?)\s*(<=|>=|<>|!=|=|<|>|like)\s*\?/gi
  const listed = /(`?[A-Za-z_][\w$]*`?(?:\s*\.\s*`?[A-Za-z_][\w$]*`?)?)\s+in\s*\(([^)]*)\)/gi
  let match

  while ((match = comparison.exec(code)) !== null) {
    const at = match.index + match[0].length - 1

    setIfAbsent(columns, positions.indexOf(at), columnOf(match[1]))
  }

  while ((match = listed.exec(code)) !== null) {
    const start = match.index + match[0].lastIndexOf('(') + 1
    const end = start + match[2].length

    positions.forEach((position, index) => {
      if (position >= start && position < end) {
        setIfAbsent(columns, index, columnOf(match[1]))
      }
    })
  }

  return columns
}

/**
 * @param {Map} map
 * @param {Number} key
 * @param {String} value
 */
const setIfAbsent = (map, key, value) => {
  if (key >= 0 && value && !map.has(key)) {
    map.set(key, value)
  }
}

/**
 * Which binding of a statement belongs to which column, so far as the SQL says.
 *
 * A statement is paired where the column is written next to its placeholder:
 * an `insert`'s column list against its values, `column = ?` in a `set` or a
 * `where`, and `column in (?, …)`. A placeholder the statement does not name a
 * column for — `where ?`, a value inside a function call, a `limit ?` — is left
 * alone, because guessing would hide a value that is not the one named.
 *
 * @param {String} sql
 * @return {Map<Number, String>} binding index => column
 */
const bindingColumns = sql => {
  const {positions, code} = placeholdersOf(sql)

  if (positions.length === 0) {
    return new Map()
  }

  return new Map([...insertColumns(code, positions), ...comparedColumns(code, positions)])
}

/**
 * A query with the bindings its SQL pairs with a hidden column replaced.
 *
 * The statement, its line and its time are kept: the pane and an agent see the
 * same statement, and only the value handed to it is gone.
 *
 * @param {Object} query the envelope's `queries` entry
 * @param {any} fields see `redactPatterns`
 * @return {Object}
 */
const redactQuery = (query, fields) => {
  const patterns = redactPatterns(fields)

  if (patterns.length === 0 || !query || typeof query !== 'object' || !Array.isArray(query.bindings)) {
    return query
  }

  if (query.bindings.length === 0) {
    return query
  }

  const columns = bindingColumns(typeof query.sql === 'string' ? query.sql : '')
  let changed = false
  const bindings = query.bindings.map((binding, index) => {
    const column = columns.get(index)

    if (column && hiddenKey(column, patterns) && binding !== null && binding !== undefined) {
      changed = true

      return HIDDEN
    }

    return binding
  })

  return changed ? Object.assign({}, query, {bindings}) : query
}

/**
 * A run's envelope with every value it carries hidden by its field name.
 *
 * The whole envelope is walked, which is what covers a run's value, the same
 * value under each block, a dry run's transaction report and a sandbox's, and
 * any row diff under them. What the run printed is text and is kept: it has no
 * field names to go by, and it is the person's own output. The queries are
 * paired with their SQL separately.
 *
 * @param {Object} result the run envelope
 * @param {any} fields see `redactPatterns`
 * @return {Object} the same envelope when nothing is hidden
 */
const redactResult = (result, fields) => {
  const patterns = redactPatterns(fields)

  if (patterns.length === 0 || result === null || typeof result !== 'object') {
    return result
  }

  const redacted = walk(result, key => hiddenKey(key, patterns))

  if (Array.isArray(redacted.queries)) {
    redacted.queries = redacted.queries.map(query => redactQuery(query, fields))
  }

  return redacted
}

module.exports = {
  HIDDEN,
  defaultRedactFields,
  redactPatterns,
  redactValue,
  redactQuery,
  redactResult,
  bindingColumns,
}
