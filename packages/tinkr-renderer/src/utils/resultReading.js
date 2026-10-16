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

export const entriesOf = value => (Array.isArray(value)
  ? value.map((item, index) => [index, item])
  : Object.entries(value))

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

/** Cuts text to a budget, saying it was cut, without touching what fits. */
export const truncate = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** The design's colour-coded type of a leaf. */
export const scalarClass = value => ({
  number: 't-number',
  boolean: 't-bool',
  string: 't-string',
}[typeof value] || 't-null')

/** How a leaf is written: a string is quoted the way the session printed it. */
export const scalarText = value => (typeof value === 'string' ? JSON.stringify(value) : String(value))

const namesOf = row => (Array.isArray(row)
  ? row.map((item, index) => String(index))
  : Object.keys(row))

/**
 * The table reading of a value: a list whose every item is a row of keyed
 * values, as `DB::select` returns and as a collection of models json-encodes.
 *
 * A list of scalars is not a table — its rows would be one column of the same
 * values the tree already draws one under the other — and neither is anything
 * that is not a list.
 *
 * @param {any} value
 * @return {{rows: Array, columns: Array<String>, shown: Array, more: Number}|null}
 */
export const tableOf = value => {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }

  if (!value.every(isComposite)) {
    return null
  }

  // the columns are the keys of every row, in the order the rows first name
  // them, so a row that carries a key the others do not still gets a column
  const columns = []

  for (const row of value) {
    for (const name of namesOf(row)) {
      if (!columns.includes(name)) {
        columns.push(name)
      }
    }
  }

  return {
    rows: value,
    columns,
    shown: value.slice(0, ROWS_READ),
    more: value.length - Math.min(value.length, ROWS_READ),
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
 * @param {any} value
 * @return {{kind: String, className: String, text: String, full: String}}
 */
export const cellOf = value => {
  // a row that does not carry the key has no value to read there, and an empty
  // cell says that; the word for nothing would not
  if (value === undefined) {
    return {kind: 'absent', className: 't-null', text: '', full: '', cut: false}
  }

  if (isComposite(value)) {
    return {kind: 'composite', className: 't-class', text: '', full: '', cut: false}
  }

  const text = typeof value === 'string'
    ? JSON.stringify(truncate(value, CELL_CHARS))
    : scalarText(value)
  const full = typeof value === 'string'
    ? JSON.stringify(truncate(value, CELL_TITLE_CHARS))
    : scalarText(value)

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
  const isList = Array.isArray(value)
  const size = entriesOf(value).length

  return `${intl.formatMessage({id: isList ? 'result.array' : 'result.object'})} · ${size}`
}

const csvCell = value => {
  if (value === null || value === undefined) {
    return ''
  }

  return isComposite(value) ? JSON.stringify(value) : String(value)
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
  columns.map(quoted).join(','),
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
        return list.some(value => looksLikeHtml(value))
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
      return looksLikeHtml(value) ? 'html' : 'organized'
    default:
      return 'organized'
  }
}

export const ROWS_SHOWN = ROWS_READ
