/**
 * A run as Markdown: the shape a snippet takes when it leaves the app for a
 * pull request, an issue, or a chat with someone who wants to read what came
 * back.
 *
 * The block is heading-free on purpose: it is pasted under a title the person
 * already wrote, and a level-one heading inside an issue body would compete
 * with the issue's own. What it says instead is a line of labels — where it ran
 * and when — and then one fenced block per thing the run did.
 *
 * Every word the block uses is given to it, so the export reads in the app's
 * language rather than in English: the pane builds them with intl and passes
 * them here. What is the database's own — the sql, its bindings, the plan's
 * columns — is not translated, because it is not the app's words.
 *
 * A value is written as the data it is, without what the envelope says about it:
 * a `__tinkr` key in a fenced block would read as a field the run never had.
 */

import {plainValue} from './resultReading'

// a value of a megabyte is a paste nobody can read in a table cell, and a
// gist is the right place for one: what a code block holds is capped, and the
// cap is said rather than left to look like the end of the value
export const MARKDOWN_LIMIT = 20000

/**
 * A table cell is one line: a pipe would end the cell and a newline would end
 * the row, so both are written as what markdown reads them as.
 *
 * @param {any} value
 * @return {String}
 */
export const markdownCell = value => String(value === null || value === undefined ? '' : value)
  .replace(/\|/g, '\\|')
  .replace(/\r\n|\r|\n/g, '<br>')

/**
 * A fenced block, with the note that says when its contents were cut.
 *
 * The fence is longer than the longest run of backticks in what it holds, so a
 * value or a print that carries a fence of its own never ends the block early;
 * three is the shortest a fence can be.
 *
 * @param {String} language
 * @param {String} text
 * @param {Function} truncated  characters omitted => the note's words
 * @return {String}
 */
const fenced = (language, text, truncated) => {
  const value = typeof text === 'string' ? text : ''
  const cut = value.length - MARKDOWN_LIMIT
  const body = cut > 0 ? value.slice(0, MARKDOWN_LIMIT) : value
  const longest = (body.match(/`+/g) || []).reduce((most, run) => Math.max(most, run.length), 0)
  const fence = '`'.repeat(Math.max(3, longest + 1))

  return [
    `${fence}${language}`,
    body,
    fence,
    cut > 0 ? `_${truncated(cut)}_` : '',
  ].filter(line => line !== '').join('\n')
}

const json = value => JSON.stringify(plainValue(value), null, 2)

const errorLine = error => `${error.class || 'Error'}: ${error.message || ''}`

/**
 * Where an error was thrown: the line of the snippet it was on, or the file and
 * line of the code outside it. The one is the reader's own code and is named by
 * its number; the other is a path, which is not the app's words to translate.
 *
 * @param {Object} error
 * @param {Object} labels
 * @param {Number} [statement] the line the statement started on, which the
 * block's own heading already says: a line equal to it is not written again
 * @return {String} empty when the envelope did not know
 */
const errorWhere = (error, labels, statement = null) => {
  const line = Number(error.line)

  if (Number.isInteger(line) && line > 0) {
    return Number(statement) === line ? '' : labels.line(line)
  }

  if (typeof error.file === 'string' && error.file !== '') {
    return Number.isInteger(Number(error.fileLine)) ? `${error.file}:${error.fileLine}` : error.file
  }

  return ''
}

const frameCall = frame => (frame.class ? `${frame.class}->${frame.function}` : frame.function)

/**
 * The frames an exception came through, as the list the block already writes
 * for a guarded run: one line each, with the snippet's own frames saying their
 * line and the rest saying their file and line.
 *
 * @param {Object} error
 * @param {Object} labels
 * @return {String} empty when the error carried no frames
 */
const errorTrace = (error, labels) => {
  const frames = Array.isArray(error.trace) ? error.trace.filter(Boolean) : []

  if (frames.length === 0) {
    return ''
  }

  const rows = frames.map((frame, index) => {
    const where = frame.snippet ? labels.line(Number(frame.line) || 0) : `${frame.file}:${frame.line}`

    return `- ${index}. ${where} ${frameCall(frame)}`
  })

  return `**${labels.trace}**\n\n${rows.join('\n')}`
}

const queriesTable = (queries, labels) => {
  if (!Array.isArray(queries) || queries.length === 0) {
    return ''
  }

  const head = ['#', labels.sql, labels.bindings, labels.ms, labels.connectionColumn]
  const rows = queries.map((query, index) => [
    index + 1,
    markdownCell(query.sql),
    markdownCell(JSON.stringify(query.bindings || [])),
    markdownCell(query.time),
    markdownCell(query.connection),
  ])

  return [
    `| ${head.map(markdownCell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
}

/**
 * What a statement dumped, one section per value: the line it was dumped from,
 * and the value as json — the same value the pane draws as a tree, because a
 * dump is data and a fenced block is how the block carries data.
 *
 * @param {Object} block
 * @param {Object} labels
 * @return {String} empty when the statement dumped nothing
 */
const dumpSections = (block, labels) => {
  const dumps = Array.isArray(block.dumps) ? block.dumps.filter(Boolean) : []

  return dumps.map(dump => {
    const line = Number.isInteger(Number(dump.line)) && Number(dump.line) > 0
      ? ` · ${labels.line(Number(dump.line))}`
      : ''

    return `**${labels.dumped}${line}**\n\n${fenced('json', json(dump.value), labels.truncated)}`
  })
}

/**
 * The whole of a run as one Markdown block.
 *
 * @param {Object} run
 * @param {String} [run.code]  the snippet as it was sent
 * @param {Object} [run.result]  the run's envelope
 * @param {String} [run.connection]  the connection's name
 * @param {String} [run.when]  when the run was sent, already formatted
 * @param {Object} run.labels  the words, built by the pane with intl
 * @param {Object} [run.guarded]  `{dryRun: Array<String>, sandbox: Array<String>}`
 * @param {{label: String, text: String}|null} [run.ended]  how the run ended on
 *   purpose, when it did, and the label it is written under
 * @param {{label: String, text: String}|null} [run.stats]  what the snippet spent
 * @return {String}
 */
export const runMarkdown = ({
  code = '',
  result = {},
  connection = '',
  when = '',
  labels = {},
  guarded = {},
  ended = null,
  stats = null,
}) => {
  const sections = []
  const where = []

  if (connection) {
    where.push(`${labels.connection}: ${connection}`)
  }

  if (when) {
    where.push(`${labels.when}: ${when}`)
  }

  if (where.length) {
    sections.push(where.join('\n'))
  }

  if (code) {
    sections.push(fenced('php', code, labels.truncated))
  }

  // a run that left on purpose says so before what it answered: it is why the
  // block has no more than it has. What the snippet spent is the run's own
  // measurement, and is said beside it
  for (const fact of [ended, stats]) {
    if (fact) {
      sections.push(`**${fact.label}**\n\n${fact.text}`)
    }
  }

  // a run of several statements is read statement by statement: its value is
  // the last one's, and leaving the others out would lose what the run did
  const blocks = Array.isArray(result.blocks) ? result.blocks : []
  const several = blocks.length > 1

  if (several) {
    for (const block of blocks) {
      if (!block) {
        continue
      }

      const label = `**${labels.statement(Number(block.line) || 0)}**`

      if (block.error) {
        sections.push([
          `${label}\n\n${labels.error}: ${errorLine(block.error)}`,
          errorWhere(block.error, labels, block.line),
          errorTrace(block.error, labels),
        ].filter(Boolean).join('\n\n'))
      } else if (block.value !== null && block.value !== undefined) {
        sections.push(`${label}\n\n${fenced('json', json(block.value), labels.truncated)}`)
      }

      sections.push(...dumpSections(block, labels))
    }

    // a failure that ended the run outside its statements has no block of its
    // own, and is still the reason the run stopped
    if (result.error && !blocks.some(block => block && block.error)) {
      sections.push([
        `**${labels.error}**\n\n${errorLine(result.error)}`,
        errorWhere(result.error, labels),
        errorTrace(result.error, labels),
      ].filter(Boolean).join('\n\n'))
    }
  } else {
    for (const block of blocks) {
      if (block) {
        sections.push(...dumpSections(block, labels))
      }
    }

    if (result.value !== null && result.value !== undefined) {
      sections.push(`**${labels.returned}**\n\n${fenced('json', json(result.value), labels.truncated)}`)
    }

    if (result.error) {
      sections.push([
        `**${labels.error}**\n\n${errorLine(result.error)}`,
        errorWhere(result.error, labels),
        errorTrace(result.error, labels),
      ].filter(Boolean).join('\n\n'))
    }
  }

  if (result.output) {
    sections.push(`**${labels.printed}**\n\n${fenced('text', result.output, labels.truncated)}`)
  }

  const table = queriesTable(result.queries, labels)

  if (table) {
    const missing = Math.max(0, (result.queriesTotal || 0) - result.queries.length)
    const more = missing > 0 && labels.moreQueries ? `\n\n_${labels.moreQueries(missing)}_` : ''

    sections.push(`**${labels.queries}**\n\n${table}${more}`)
  }

  const dryRun = Array.isArray(guarded.dryRun) ? guarded.dryRun.filter(Boolean) : []
  const sandbox = Array.isArray(guarded.sandbox) ? guarded.sandbox.filter(Boolean) : []

  if (dryRun.length) {
    sections.push(`**${labels.dryRun}**\n\n${dryRun.map(line => `- ${line}`).join('\n')}`)
  }

  if (sandbox.length) {
    sections.push(`**${labels.sandbox}**\n\n${sandbox.map(line => `- ${line}`).join('\n')}`)
  }

  return sections.length ? `${sections.join('\n\n')}\n` : ''
}
