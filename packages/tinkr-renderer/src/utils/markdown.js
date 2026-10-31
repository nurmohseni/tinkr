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
 */

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
 * @param {String} language
 * @param {String} text
 * @param {Function} truncated  characters omitted => the note's words
 * @return {String}
 */
const fenced = (language, text, truncated) => {
  const value = typeof text === 'string' ? text : ''
  const cut = value.length - MARKDOWN_LIMIT
  const body = cut > 0 ? value.slice(0, MARKDOWN_LIMIT) : value

  return [
    `\`\`\`${language}`,
    body,
    '```',
    cut > 0 ? `_${truncated(cut)}_` : '',
  ].filter(line => line !== '').join('\n')
}

const json = value => JSON.stringify(value, null, 2)

const errorLine = error => `${error.class || 'Error'}: ${error.message || ''}`

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
 * The whole of a run as one Markdown block.
 *
 * @param {Object} run
 * @param {String} [run.code]  the snippet as it was sent
 * @param {Object} [run.result]  the run's envelope
 * @param {String} [run.connection]  the connection's name
 * @param {String} [run.when]  when the run was sent, already formatted
 * @param {Object} run.labels  the words, built by the pane with intl
 * @param {Object} [run.guarded]  `{dryRun: Array<String>, sandbox: Array<String>}`
 * @return {String}
 */
export const runMarkdown = ({code = '', result = {}, connection = '', when = '', labels = {}, guarded = {}}) => {
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
        sections.push(`${label}\n\n${labels.error}: ${errorLine(block.error)}`)
      } else if (block.value !== null && block.value !== undefined) {
        sections.push(`${label}\n\n${fenced('json', json(block.value), labels.truncated)}`)
      }
    }

    // a failure that ended the run outside its statements has no block of its
    // own, and is still the reason the run stopped
    if (result.error && !blocks.some(block => block && block.error)) {
      sections.push(`**${labels.error}**\n\n${errorLine(result.error)}`)
    }
  } else {
    if (result.value !== null && result.value !== undefined) {
      sections.push(`**${labels.returned}**\n\n${fenced('json', json(result.value), labels.truncated)}`)
    }

    if (result.error) {
      sections.push(`**${labels.error}**\n\n${errorLine(result.error)}`)
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
