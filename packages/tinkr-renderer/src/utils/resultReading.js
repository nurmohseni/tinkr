/**
 * How a value can be read besides as a tree, and what each reading is made of.
 *
 * The tree is the reading a value always has. The others belong to a shape: a
 * list of rows can be read as a table, a composite can be read as a graph, and
 * markup can be read as itself. Whether each one is offered is decided here,
 * in one place, so the switch and the reading it turns on can never disagree —
 * and each one falls back to the tree rather than showing nothing.
 */

/** The tree's own test, repeated here because a reading is decided without it. */
export const isComposite = value => value !== null && typeof value === 'object'

/**
 * Everything the envelope says about a value is written under `__tinkr`, beside
 * the value rather than in it: the class it had, the markup it rendered to, the
 * case an enum is, the names a closure closed over, a model's key and loaded
 * relations. Those keys are not fields of the value, so no tree draws one and no
 * table has a column for one.
 */
const META = /^__tinkr/

/** Whether a name is what the envelope says about a value rather than a field. */
const isMetaKey = name => typeof name === 'string' && META.test(name)

/** A record is an object that carries fields; a list is not one. */
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The value a record carries, which for a record of fields is the record
 * itself: a value that is not a set of fields — a serialized list, an enum case,
 * a stringable wrapper — is written under `__tinkrMap`.
 */
export const contentOf = value => (isRecord(value) && '__tinkrMap' in value ? value.__tinkrMap : value)

/** Whether the value is a list, which is the shape a table has. */
export const isList = value => Array.isArray(contentOf(value))

/** The class the value had, when the envelope said what it was. */
export const classOf = value => (isRecord(value) && typeof value.__tinkrClass === 'string'
  ? value.__tinkrClass
  : null)

/** The markup a value rendered to, if it rendered any. */
export const markupOf = value => (isRecord(value) && typeof value.__tinkrHtml === 'string'
  ? value.__tinkrHtml
  : null)

/** The fields of a value, in the order the envelope said they ran in. */
const namesOfRecord = (value, content) => {
  const keys = Array.isArray(value.__tinkrKeys)
    ? value.__tinkrKeys.filter(name => Object.prototype.hasOwnProperty.call(content, name) && !isMetaKey(name))
    : null

  return keys || Object.keys(content).filter(name => !isMetaKey(name))
}

export const entriesOf = value => {
  const content = contentOf(value)

  if (Array.isArray(content)) {
    return content.map((item, index) => [index, item])
  }

  if (content === null || typeof content !== 'object') {
    return []
  }

  return namesOfRecord(value, content).map(name => [name, content[name]])
}

/**
 * The value without what the envelope says about it: the copy a reader pastes
 * somewhere, where a metadata key would read as a field the run never had, and
 * a rendered value reads as the markup it is.
 *
 * @param {any} value
 * @return {any}
 */
export const plainValue = value => {
  if (Array.isArray(value)) {
    return value.map(plainValue)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  if (typeof value.__tinkrHtml === 'string') {
    return value.__tinkrHtml
  }

  if (typeof value.__tinkrEnum === 'string') {
    return '__tinkrBacked' in value
      ? plainValue(value.__tinkrBacked)
      : `${value.__tinkrClass || ''}::${value.__tinkrEnum}`
  }

  if (isRecord(value.__tinkrClosure)) {
    return closureText(value.__tinkrClosure)
  }

  if ('__tinkrMap' in value) {
    return plainValue(value.__tinkrMap)
  }

  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => !isMetaKey(name))
    .map(([name, item]) => [name, plainValue(item)]))
}

/**
 * A closure as php writes its signature: what it takes, and the names it closed
 * over — never what any of them is worth.
 *
 * @param {{params: Array<String>, uses: Array<String>}} closure
 * @return {String}
 */
export const closureText = closure => {
  const params = Array.isArray(closure.params) ? closure.params : []
  const uses = Array.isArray(closure.uses) ? closure.uses : []
  const bound = uses.length ? ` use (${uses.map(name => `$${name}`).join(', ')})` : ''

  return `Closure(${params.join(', ')})${bound}`
}

/**
 * An enum case, as php writes it: the case, and the value behind it when it is
 * backed. The class is part of the name, so this is the whole of it.
 *
 * @param {Object} value the record
 * @return {{name: String, backed: Boolean}}
 */
export const enumOf = value => (isRecord(value) && typeof value.__tinkrEnum === 'string'
  ? {name: `${value.__tinkrClass || ''}::${value.__tinkrEnum}`, backed: '__tinkrBacked' in value}
  : null)

// a table is read a window at a time: the pane is short, and the rows past this
// one are still exported whole, they are just not in the dom
const ROWS_READ = 500

// a cell is one line of a table, so what goes in it is cut to what the column
// can show; the whole of it is kept for the tooltip, cut too, because a value
// of a megabyte must not become an attribute of a table cell. what a cell
// writes is shared: the query log cuts its statements by the same budget
export const CELL_CHARS = 120
const CELL_TITLE_CHARS = 600

// markup is recognised by its first characters; a document longer than this has
// said what it is long before the budget runs out
const MARKUP_CHARS = 8192

/**
 * Cuts text to a budget, saying it was cut, without touching what fits. The cut
 * never lands inside a character: a string is measured in utf-16 units, so a
 * cut can fall between the two halves of a surrogate pair, and half a character
 * is drawn as a broken one. One unit is given back when that is where the cut
 * would land.
 */
export const truncate = (text, max) => {
  if (text.length <= max) {
    return text
  }

  const split = max > 0 &&
    text.charCodeAt(max - 1) >= 0xd800 && text.charCodeAt(max - 1) <= 0xdbff &&
    text.charCodeAt(max) >= 0xdc00 && text.charCodeAt(max) <= 0xdfff

  return `${text.slice(0, split ? max - 1 : max)}…`
}

/** The design's colour-coded type of a leaf. */
export const scalarClass = value => ({
  number: 't-number',
  boolean: 't-bool',
  string: 't-string',
}[typeof value] || 't-null')

/** How a leaf is written: a string is quoted the way the session printed it. */
export const scalarText = value => (typeof value === 'string' ? JSON.stringify(value) : String(value))

const namesOf = row => entriesOf(row).map(([name]) => String(name))

/**
 * The table reading of a value: a list whose every item is a row of keyed
 * values, as `DB::select` returns and as a collection of models json-encodes.
 *
 * A list of scalars is not a table — its rows would be one column of the same
 * values the tree already draws one under the other — and neither is anything
 * that is not a list. What the envelope says about a row — its class, a model's
 * key — is not a column of it: a table is the data, not the metadata.
 *
 * @param {any} value
 * @return {{rows: Array, columns: Array<String>, shown: Array, more: Number}|null}
 */
export const tableOf = value => {
  const content = contentOf(value)

  if (!Array.isArray(content) || content.length === 0) {
    return null
  }

  if (!content.every(isComposite)) {
    return null
  }

  // the columns are the keys of every row, in the order the rows first name
  // them, so a row that carries a key the others do not still gets a column
  const columns = []

  for (const row of content) {
    for (const name of namesOf(row)) {
      if (!columns.includes(name)) {
        columns.push(name)
      }
    }
  }

  return {
    rows: content,
    columns,
    shown: content.slice(0, ROWS_READ),
    more: content.length - Math.min(content.length, ROWS_READ),
  }
}

/**
 * The graph reading of a value: anything with something under it.
 *
 * @param {any} value
 * @return {any|null}
 */
export const graphOf = value => (isComposite(value) && entriesOf(value).length > 0 ? value : null)

/**
 * One cell of a table: what is drawn in it, and what the tooltip carries.
 *
 * A string is quoted the way the tree quotes it, so the same value reads the
 * same in both. A composite says nothing here: what a cell can show of an
 * `array` is words, and those are the reading's to say.
 *
 * A cell that is handed a text the caller wrote itself — the json of a query's
 * bindings, which is already the form to show — asks for `plain`: quoting that
 * would read as a string holding json rather than as the json it is.
 *
 * @param {any} value
 * @param {Object} [options]
 * @param {Boolean} [options.plain]  the string is written, not a string to quote
 * @return {{kind: String, className: String, text: String, full: String}}
 */
export const cellOf = (value, {plain = false} = {}) => {
  // a row that does not carry the key has no value to read there, and an empty
  // cell says that; the word for nothing would not
  if (value === undefined) {
    return {kind: 'absent', className: 't-null', text: '', full: '', cut: false}
  }

  if (isComposite(value)) {
    return {kind: 'composite', className: 't-class', text: '', full: '', cut: false}
  }

  const written = (text, budget) => (typeof text === 'string'
    ? (plain ? truncate(text, budget) : JSON.stringify(truncate(text, budget)))
    : scalarText(text))
  const text = written(value, CELL_CHARS)
  const full = written(value, CELL_TITLE_CHARS)

  return {
    kind: value === null ? 'null' : typeof value,
    className: scalarClass(value),
    text,
    full,
    cut: full !== text,
  }
}

/**
 * What a composite is, in the tree's own words: `array · 3`.
 *
 * @param {IntlShape} intl
 * @param {any} value
 * @return {String}
 */
export const compositeText = (intl, value) => {
  const list = isList(value)
  const size = entriesOf(value).length

  return `${intl.formatMessage({id: list ? 'result.array' : 'result.object'})} · ${size}`
}

// a text cell a spreadsheet would read as a formula: Excel, LibreOffice and
// Sheets all evaluate a cell that starts with one of these, so a value from the
// database could run a formula on whoever opens the file. Such a cell is given a
// leading apostrophe, which is how a spreadsheet is told the cell is text.
// Numbers are left alone: -5 is a number, not a formula
const FORMULA = /^[=+\-@\t\r]/

const neutral = text => (FORMULA.test(text) ? `'${text}` : text)

const csvCell = value => {
  if (value === null || value === undefined) {
    return ''
  }

  if (isComposite(value)) {
    return neutral(JSON.stringify(plainValue(value)))
  }

  return typeof value === 'string' ? neutral(value) : String(value)
}

const quoted = text => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)

/**
 * The whole table as a csv file: a header row named by the columns, then every
 * row, in full — the reading shows a window of the rows, the file is not a
 * window of anything.
 *
 * @param {Array<String>} columns
 * @param {Array} rows
 * @return {String}
 */
export const toCsv = (columns, rows) => [
  columns.map(name => quoted(neutral(String(name)))).join(','),
  ...rows.map(row => columns.map(name => quoted(csvCell(row[name]))).join(',')),
].join('\r\n') + '\r\n'

const DOCUMENT = /^<!doctype\s+html/i
const ROOT = /^<html[\s>]/i
const TAGS = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi

// the tags a fragment is markup by: a line of prose with a `<` in it is not
// markup, and neither is a json blob that happens to hold an angle bracket
const BLOCK_TAGS = new Set([
  'html', 'head', 'body', 'title', 'meta', 'link', 'style', 'script', 'svg',
  'div', 'span', 'p', 'a', 'img', 'br', 'hr', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'small', 'label',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'section', 'article', 'aside', 'header',
  'footer', 'main', 'nav', 'figure', 'figcaption', 'form', 'input', 'button',
  'select', 'option', 'textarea', 'fieldset', 'legend', 'iframe', 'video',
  'audio', 'canvas', 'template', 'details', 'summary', 'dialog',
])

/**
 * Whether a value is markup rather than a string that happens to be one: a
 * document says so in its first characters, and a fragment has to be made of
 * more than one tag of the set above.
 *
 * @param {any} value
 * @return {Boolean}
 */
export const looksLikeHtml = value => {
  if (typeof value !== 'string') {
    return false
  }

  const head = value.slice(0, MARKUP_CHARS).trim()

  if (head.length === 0) {
    return false
  }

  if (DOCUMENT.test(head) || ROOT.test(head)) {
    return true
  }

  let tags = 0

  for (const match of head.matchAll(TAGS)) {
    if (!BLOCK_TAGS.has(match[1].toLowerCase())) {
      continue
    }

    tags += 1

    if (tags > 1) {
      return true
    }
  }

  return false
}

// what a fragment is wrapped in to be rendered: a browser surface, so it is a
// white page with the browser's own body type, and a fragment that never set a
// background is dark text on white rather than dark text on the app's panel
const SHELL = '<!doctype html><html><head><meta charset="utf-8">' +
  '<style>html,body{margin:0}body{padding:16px;background:#fff;color:#111;' +
  'font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}</style>' +
  '</head><body>'

/**
 * What goes in the frame: a document as it is, a fragment in a shell that gives
 * it a page to be a fragment of.
 *
 * @param {String} value
 * @return {String}
 */
export const htmlDocument = value => {
  const head = value.slice(0, MARKUP_CHARS).trimStart()

  if (DOCUMENT.test(head) || ROOT.test(head)) {
    return value
  }

  return `${SHELL}${value}</body></html>`
}

/**
 * What a value renders to, when it is markup: a string the run returned, or a
 * value the envelope rendered — a view, a mailable, an `Htmlable` component.
 * Null for anything that is not markup, which is what the reading is offered on.
 *
 * @param {any} value
 * @return {String|null}
 */
export const htmlOf = value => {
  const rendered = markupOf(value)

  if (rendered !== null) {
    return rendered
  }

  return looksLikeHtml(value) ? value : null
}

/** Every reading there is, in the order the switch offers them. */
export const READINGS = ['organized', 'table', 'graph', 'html', 'raw']

/**
 * The views that exist for a value, in the order the switch offers them: the
 * tree and the raw text read anything, and the others are offered when the run
 * has something they can read.
 */
export const readingsOf = values => {
  const list = values.filter(value => value !== null && value !== undefined)

  return READINGS.filter(view => {
    switch (view) {
      case 'table':
        return list.some(value => tableOf(value))
      case 'graph':
        return list.some(value => graphOf(value))
      case 'html':
        return list.some(value => htmlOf(value) !== null)
      default:
        return true
    }
  })
}

/**
 * The reading a view is, for one value: a view is chosen over a whole run, and
 * a value that does not have it is read as its tree rather than as nothing.
 *
 * @param {String} view
 * @param {any} value
 * @return {String}
 */
export const readingOf = (view, value) => {
  switch (view) {
    case 'raw':
      return 'raw'
    case 'table':
      return tableOf(value) ? 'table' : 'organized'
    case 'graph':
      return graphOf(value) ? 'graph' : 'organized'
    case 'html':
      return htmlOf(value) !== null ? 'html' : 'organized'
    default:
      return 'organized'
  }
}

export const ROWS_SHOWN = ROWS_READ
