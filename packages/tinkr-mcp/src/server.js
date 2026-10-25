const fs = require('fs')

const {runCode, logs: logReader} = require('tinkr-core')

const app = require('./app')
const {topics, documentation} = require('./documentation')
const target = require('./target')

/**
 * The tools this server exposes, and what they answer with.
 *
 * The names are the app's own: whoever calls one is running code the way Tinkr
 * runs it — in a project, in that project's tinker session, over ssh when the
 * connection says so.
 *
 * A snippet that throws is not a tool that failed: the run happened and the code
 * failed, so the answer carries the error and the caller reasons about it. Only
 * a run that never came back — the session would not start, or the code took
 * longer than the caller was willing to wait — is a tool error.
 */

// how much of a run's own text is handed back. What it printed can be a
// megabyte of `dump` output, and its value a megabyte of rows, and a model pays
// for every character of either: the text and the structured answer are both
// cut at this, and say where they were
const maxText = 100000

const json = value => JSON.stringify(value, null, 2)

/**
 * @param {String} text
 * @param {Number} [length] how much of it to keep, when it is not the run
 * output's own limit
 * @return {String}
 */
const truncate = (text, length = maxText) => (text.length > length
  ? `${text.slice(0, length)}\n… ${text.length - length} characters were cut`
  : text)

/**
 * @param {any} value
 * @return {Boolean}
 */
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * What a dry run did with the transaction it ran in, as lines of text.
 *
 * A dry run that could not be armed, or whose transaction was gone by the end of
 * it, is the case that matters most to read: what the run changed may have been
 * kept, and it is said first and plainly.
 *
 * @param {Object|undefined} transaction the envelope's report
 * @param {String|null} guard what the run was asked to be guarded with
 * @return {Array<String>}
 */
const renderTransaction = (transaction, guard) => {
  if (!guard) {
    return []
  }

  if (!isRecord(transaction)) {
    return ['', 'Dry run: the session did not report the transaction, so whether anything was kept is not known.']
  }

  const on = transaction.connection ? ` on ${transaction.connection}` : ''
  const statements = `${transaction.statements || 0} statement${transaction.statements === 1 ? '' : 's'}`
  const lines = ['']

  if (!transaction.armed) {
    lines.push(`Dry run NOT armed${on}: ${transaction.error || 'the guard could not be armed'}.`)
  } else if (transaction.outcome === 'rolledBack') {
    lines.push(`Dry run: rolled back${on}. ${statements} sent in the transaction, none of it kept.`)
  } else if (transaction.outcome === 'broken') {
    lines.push(`Dry run BROKEN${on}: ${transaction.error || 'the transaction was closed during the run'}. ` +
      `What the ${statements} changed may have been kept.`)
  } else if (transaction.outcome === 'failed') {
    lines.push(`Dry run FAILED to roll back${on}: ${transaction.error || 'the rollback threw'}. ` +
      'What the run changed may have been kept.')
  } else {
    lines.push(`Dry run: ${transaction.outcome}${on}. ${statements}.`)
  }

  const unguarded = Object.entries(isRecord(transaction.unguarded) ? transaction.unguarded : {})

  if (unguarded.length) {
    lines.push(`Not inside the dry run, and kept: ${unguarded
      .map(([name, count]) => `${count} statement${count === 1 ? '' : 's'} on ${name}`).join(', ')}.`)
  }

  return lines
}

/**
 * What the sandbox caught, as lines of text.
 *
 * A sandboxed dry run is the case this is for: the transaction says nothing is
 * kept, and this says nothing was sent, pushed or written either. A channel that
 * could not be swapped is said plainly, because a run that only looked sealed is
 * worse than one that was not.
 *
 * @param {Object|undefined} sandbox the envelope's report
 * @return {Array<String>}
 */
const renderSandbox = sandbox => {
  if (!isRecord(sandbox)) {
    return []
  }

  const channels = isRecord(sandbox.channels) ? sandbox.channels : {}
  const counted = Object.entries(channels).filter(([, count]) => Number(count) > 0)
  const lines = ['']

  if (!counted.length) {
    lines.push('Sandbox: the run sent nothing, wrote nothing and logged nothing.')
  } else {
    lines.push(`Sandbox: ${counted.map(([name, count]) => `${count} ${name}`).join(', ')}.`)
  }

  for (const line of (Array.isArray(sandbox.sent) ? sandbox.sent : [])) {
    lines.push(`  would have mailed: ${line}`)
  }

  for (const line of (Array.isArray(sandbox.requested) ? sandbox.requested : [])) {
    lines.push(`  would have requested: ${line}`)
  }

  for (const reason of (Array.isArray(sandbox.not_sandboxed) ? sandbox.not_sandboxed : [])) {
    lines.push(`  NOT sandboxed: ${reason}`)
  }

  return lines
}

/**
 * What the run answers with, as text: every statement that answered something,
 * then what the run printed.
 *
 * The words are the app's own — a statement that threw is on its line, and the
 * run's output is "printed" — because they are what the same result is called in
 * the app's output pane.
 *
 * @param {Object} result the run envelope
 * @param {String|null} [guard] what the run was guarded with
 * @return {String}
 */
const render = (result, guard = null) => {
  const lines = []
  const blocks = Array.isArray(result.blocks) ? result.blocks : []

  for (const block of blocks) {
    if (block.error) {
      lines.push(`Line ${block.line}: threw ${block.error.class}: ${block.error.message}`)

      continue
    }

    if (block.value === null || block.value === undefined) {
      continue
    }

    lines.push(`Line ${block.line}: ${json(block.value)}`)
  }

  // a run that ended without a statement's answer — exit(), a fatal error, a
  // session that went away — says why on no line of its own
  if (result.error && !blocks.some(block => block.error)) {
    lines.push(`threw ${result.error.class}: ${result.error.message}`)
  }

  if (lines.length === 0) {
    lines.push('no value returned')
  }

  lines.push(...renderTransaction(result.transaction, guard))
  lines.push(...renderSandbox(result.sandbox))

  if (result.output) {
    lines.push('', 'printed:', result.output.replace(/\s+$/, ''))
  }

  return truncate(lines.join('\n'))
}

/**
 * @param {any} at when a history entry ran, as the entry says it
 * @return {Number|null} as a time, or nothing when it is not one: an entry
 * written by hand or by an older app may say anything
 */
const timeOf = at => {
  let time = NaN

  if (typeof at === 'number') {
    time = at
  } else if (typeof at === 'string' && at.trim() !== '') {
    time = Number.isFinite(Number(at)) ? Number(at) : Date.parse(at)
  }

  return Number.isFinite(time) && Number.isFinite(new Date(time).getTime()) ? time : null
}

/**
 * @param {any} at
 * @return {String|null}
 */
const isoOf = at => {
  const time = timeOf(at)

  return time === null ? null : new Date(time).toISOString()
}

/**
 * @param {any} error what an entry kept of the exception a run threw
 * @return {Object|null} the shape every answer of this server gives an error
 */
const errorOf = error => {
  if (error === null || error === undefined || error === false) {
    return null
  }

  if (isRecord(error)) {
    return {class: String(error.class || 'Error'), message: String(error.message || '')}
  }

  return {class: 'Error', message: String(error)}
}

/**
 * A run from the app's history, as text: when it ran and how it ended, the code
 * that ran, then what came back of what the entry kept.
 *
 * The words are the run result's own — `returned`, `printed`, `threw` — because
 * they are what the app calls the same three things in its sidebar.
 *
 * @param {Object} entry
 * @return {String}
 */
const renderRun = entry => {
  const error = errorOf(entry.error)
  const lines = [
    `${isoOf(entry.at) || 'at an unknown time'} · ${entry.outcome || 'unknown outcome'} · ${entry.id}`,
    '',
    typeof entry.code === 'string' ? truncate(entry.code, 4000) : '(the entry keeps no code)',
  ]

  if (error) {
    lines.push('', `threw ${error.class}: ${error.message}`)
  }

  if (entry.value !== undefined) {
    lines.push('', 'returned:', json(entry.value))
  }

  if (typeof entry.output === 'string' && entry.output) {
    lines.push('', 'printed:', entry.output.replace(/\s+$/, ''))
  }

  if (Array.isArray(entry.cut) && entry.cut.length) {
    lines.push('', `not kept whole: ${entry.cut.join(', ')}`)
  }

  return truncate(lines.join('\n'))
}

/**
 * A value, kept whole when its json fits in `budget` characters, and otherwise
 * replaced by as much of its json as does, with what was cut said at the end.
 *
 * @param {any} value
 * @param {Number} budget
 * @return {{value: any, size: Number, cut: Boolean}}
 */
const cutValue = (value, budget) => {
  let text

  try {
    text = JSON.stringify(value)
  } catch (e) {
    text = String(value)
  }

  if (text === undefined || text.length <= budget) {
    return {value, size: text === undefined ? 0 : text.length, cut: false}
  }

  const kept = Math.max(budget, 0)

  return {value: `${text.slice(0, kept)}… ${text.length - kept} characters were cut`, size: kept, cut: true}
}

/**
 * @param {any} error
 * @return {any} the error, with a message no longer than the text's limit
 */
const cutError = error => (isRecord(error) && typeof error.message === 'string' && error.message.length > maxText
  ? Object.assign({}, error, {message: truncate(error.message)})
  : error)

/**
 * The run as the structured answer carries it: the same limit as the text, so a
 * client that hands the structured answer to a model does not hand it the five
 * megabytes the text was cut from.
 *
 * What printed, the value, the statements' values together and the queries
 * together each get the limit; a value past it becomes the start of its json and
 * a note of how much was cut, and `cut` names every part that was cut.
 *
 * @param {Object} result
 * @return {Object}
 */
const bound = result => {
  const bounded = Object.assign({}, result)
  const cut = Array.isArray(result.cut) ? result.cut.slice() : []
  const mark = part => {
    if (!cut.includes(part)) {
      cut.push(part)
    }
  }

  if (typeof result.output === 'string' && result.output.length > maxText) {
    bounded.output = truncate(result.output)
    mark('output')
  }

  if ('value' in result) {
    const value = cutValue(result.value, maxText)

    if (value.cut) {
      bounded.value = value.value
      mark('value')
    }
  }

  if (isRecord(result.error) && result.error !== cutError(result.error)) {
    bounded.error = cutError(result.error)
    mark('error')
  }

  if (Array.isArray(result.blocks)) {
    let budget = maxText

    bounded.blocks = result.blocks.map(block => {
      if (!isRecord(block)) {
        return block
      }

      const value = cutValue(block.value, budget)
      const error = cutError(block.error)

      budget -= value.size

      if (!value.cut && error === block.error) {
        return block
      }

      mark('blocks')

      return Object.assign({}, block, {value: value.value, error})
    })
  }

  if (Array.isArray(result.queries)) {
    let budget = maxText
    const kept = []

    for (const query of result.queries) {
      const size = (JSON.stringify(query) || '').length

      if (size > budget) {
        mark('queries')

        break
      }

      budget -= size
      kept.push(query)
    }

    bounded.queries = kept
  }

  if (cut.length) {
    bounded.cut = cut
  }

  return bounded
}

/**
 * The run, as the tool answers with it.
 *
 * @param {Object} result
 * @param {String|null} guard
 * @return {{content: Array, structuredContent: Object, isError: Boolean}}
 */
const answer = (result, guard) => ({
  content: [{type: 'text', text: render(result, guard)}],
  structuredContent: bound(result),
  isError: false,
})

/**
 * The call that did not come back, as the tool answers with it: the code never
 * ran, so there is no result to read, only what went wrong.
 *
 * The structured answer has the shape every tool's error has — an object with a
 * class and a message — because a client checks it against the tool's output
 * schema, and one that does not match is thrown away with the message in it.
 *
 * @param {Error} error
 * @return {{content: Array, structuredContent: Object, isError: Boolean}}
 */
const failure = error => {
  if (error && error.name === 'SessionError') {
    return sessionFailureOf(error)
  }

  return {
    content: [{type: 'text', text: truncate(error.message)}],
    structuredContent: {error: {class: error.name === 'AbortError' ? 'Cancelled' : 'ToolError', message: truncate(error.message)}},
    isError: true,
  }
}

/**
 * A run whose session never came up — the connection's command failed to boot,
 * or exited — as the tool answers with it.
 *
 * The command's own words are the answer: a missing `artisan`, a platform check
 * that refuses the php, a php that is not on the path. Waiting for the timeout
 * and saying only that nothing answered threw that away, and it is the one thing
 * that says what to fix.
 *
 * @param {Error} error the SessionError runCode raised
 * @return {{content: Array, structuredContent: Object, isError: Boolean}}
 */
const sessionFailureOf = error => {
  const output = typeof error.output === 'string' ? error.output : ''
  const message = truncate(output ? `${error.message}` : error.message)

  return {
    content: [{type: 'text', text: truncate(message)}],
    structuredContent: bound({
      blocks: [],
      value: null,
      error: {class: 'SessionError', message},
      queries: [],
      queriesTotal: 0,
      output: truncate(output),
    }),
    isError: true,
  }
}

/**
 * A run whose session ended before it answered — it would not boot, or it died
 * — as the tool answers with it: a tool error, with what the terminal said.
 *
 * @param {Object} result the envelope the session answered with
 * @return {{content: Array, structuredContent: Object, isError: Boolean}}
 */
const sessionFailure = result => ({
  content: [{type: 'text', text: truncate(`The session ended before the run answered: ${result.error.message}`)}],
  structuredContent: bound(result),
  isError: true,
})

/**
 * @param {Object} args
 * @return {String}
 */
const codeOf = args => {
  if (typeof args.code !== 'string' || args.code.trim() === '') {
    throw new Error('`code` is required: the PHP to run.')
  }

  return args.code
}

/**
 * @param {Object} args
 * @return {String|null} what the run is guarded with: a dry run, or nothing
 */
const guardOf = args => {
  if (args.guard === undefined || args.guard === null) {
    return null
  }

  if (args.guard !== 'rollback' && args.guard !== 'sandbox') {
    throw new Error('`guard` can only be "rollback" (a dry run, whose database changes are ' +
      'taken back) or "sandbox" (the same, with mail, jobs, HTTP calls, file writes, the cache ' +
      'and the log recorded instead of happening).')
  }

  return args.guard
}

/**
 * @param {Object} args
 * @param {Number} fallback
 * @return {Number}
 */
const timeoutOf = (args, fallback) => {
  const asked = Number(args.timeout_ms)

  if (!Number.isFinite(asked) || asked <= 0) {
    return fallback
  }

  // a session that is given a minute is a session that is still holding a pty
  // when the client that asked for it has gone
  return Math.min(Math.max(asked, 1000), 600000)
}

/**
 * How many runs a list shows: enough to scan, few enough to read.
 *
 * @param {Object} args
 * @return {Number}
 */
const limitOf = args => {
  if (args.limit === undefined || args.limit === null) {
    return 10
  }

  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50) {
    throw new Error('`limit` is how many runs to list: a whole number from 1 to 50.')
  }

  return args.limit
}

/**
 * A saved connection, as a client reads it.
 *
 * A Laravel Cloud connection has no command and no server to attach to: its code
 * runs as a command inside an environment Laravel Cloud owns, named here by the
 * application and environment it was saved with. Its `path` is only the local
 * checkout the class index is read from, so it is reported as that rather than
 * as where the code runs.
 *
 * `cloud` is there only for a cloud connection: every other kind reads exactly
 * as it always has.
 *
 * @param {Record<String, any>} connection
 * @return {Object}
 */
/**
 * A size of a file, as a person reads it.
 *
 * @param {Number} size
 * @return {String}
 */
const bytesOf = size => {
  const bytes = Number(size) || 0

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * One log entry as the lines of an answer, written the way the file wrote it:
 * `[when] channel.LEVEL: what it said`, with the context and the stack trace
 * indented under it.
 *
 * @param {Object} entry
 * @return {String}
 */
const renderEntry = entry => {
  const said = entry.level === null ? 'text' : entry.level.toUpperCase()
  const where = entry.environment === null ? said : `${entry.environment}.${said}`
  const lines = [`[${entry.at === null ? 'at an unknown time' : entry.at}] ${where}: ${entry.message}`]

  if (entry.details !== '') {
    lines.push(...entry.details.split('\n').map(line => `  ${line}`))
  }

  return lines.join('\n')
}

/**
 * A read of a log as text: what was read of what there is, the entries, and what
 * to ask next.
 *
 * The notes at the end are the two ways to walk a log — back through its bytes,
 * and back through the matches of a filter — said only when there is something
 * behind them: a caller that has reached the end of the file is not told to go
 * further.
 *
 * @param {Object} answer the log's own answer, with `filtered` and `older` beside it
 * @return {String}
 */
const renderLogs = answer => {
  const lines = [answer.filtered
    ? `${answer.file} · ${bytesOf(answer.size)} · ${answer.entries.length} ` +
      `match${answer.entries.length === 1 ? '' : 'es'} in the ${bytesOf(answer.read)} scanned`
    : `${answer.file} · ${bytesOf(answer.size)} · the bytes ${answer.from}–${answer.to}`]

  if (answer.entries.length === 0) {
    lines.push('', answer.filtered
      ? 'No entry in that range matches.'
      : 'No entries in this window.')
  }

  for (const entry of answer.entries) {
    lines.push('', renderEntry(entry))
  }

  if (answer.older > 0) {
    lines.push('', `${answer.older} older matching ${answer.older === 1 ? 'entry was' : 'entries were'} ` +
      'not included: raise `limit`, or narrow the read with `since`/`until`.')
  }

  if (!answer.filtered && answer.from > 0) {
    lines.push('', `There is more before this window: pass \`before: ${answer.from}\` for the page before it.`)
  }

  if (!answer.filtered && answer.to < answer.size) {
    lines.push('', `There is more after it: pass \`after: ${answer.to}\` for the page after it.`)
  }

  return lines.join('\n')
}

const connectionInfo = connection => {
  const info = {
    id: connection.id,
    name: connection.name || null,
    tag: connection.tag || null,
    directory: connection.is_over_ssh || connection.is_cloud ? null : connection.path || null,
    command: connection.is_cloud ? null : connection.command || null,
    over_ssh: Boolean(connection.is_over_ssh),
    ssh: connection.is_over_ssh
      ? {
          server: connection.ssh_server || null,
          user: connection.ssh_user || null,
          port: connection.ssh_port || null,
        }
      : null,
  }

  if (connection.is_cloud) {
    info.cloud = {
      application: {
        id: connection.cloud_application_id || null,
        name: connection.cloud_application_name || null,
      },
      environment: {
        id: connection.cloud_environment_id || null,
        name: connection.cloud_environment_name || null,
      },
      // the checkout, when there is one, is read for class names only
      local_checkout: connection.path || null,
    }
  }

  return info
}

const productionRule = 'A connection tagged production is refused unless this server was started on ' +
  'it (--connection) or with --allow-production.'

const guardInput = {
  type: 'string',
  enum: ['rollback', 'sandbox'],
  description: '"rollback" runs the code as a dry run: inside a database transaction that is ' +
    'rolled back at the end, and the answer reports it (`transaction`). Only the database ' +
    'connection the run starts on is inside it; statements sent to other connections and DDL ' +
    'that commits by itself on MySQL are not taken back, and the report says when the ' +
    'transaction was broken. "sandbox" is the same transaction with the side-effect drivers ' +
    'swapped for recorders first: mail goes to the array transport, jobs and the bus to their ' +
    'fakes, the HTTP client answers only what it was given, every disk is faked under ' +
    'storage/framework, the cache is an array store and logging records instead of writing. The ' +
    'answer then carries `sandbox`: a count per channel with the first twenty mails and ' +
    'requests named, and any channel it could not swap. A transaction holds the database and ' +
    'nothing else, so use "sandbox" when the code might send, queue, call or write something.',
}

const timeoutInput = {
  type: 'number',
  description: 'How long to wait for the session before giving up, in milliseconds. ' +
    'A minute by default. A run that is given up on is stopped.',
}

const connectionInput = {
  type: 'string',
  description: 'The id or name of a connection saved in Tinkr. The connection this server was ' +
    'started on when it is not given.',
}

const logFileInput = {
  type: 'string',
  description: 'The name of a log file of the connection, as tinkr_list_logs lists it. The ' +
    'newest file when it is not given.',
}

const logSinceInput = {
  type: 'string',
  description: 'A moment to read from, written as the file stamps its entries: ' +
    '"2026-08-27 11:10:52". The moment is found in the file itself, so a range reaches entries ' +
    'no window holds. Open-ended when it is not given.',
}

const logUntilInput = {
  type: 'string',
  description: 'A moment to stop reading after, in the same shape as `since`. Open-ended when ' +
    'it is not given.',
}

const logLevelInput = {
  type: ['string', 'array'],
  items: {
    type: 'string',
    enum: ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'],
  },
  description: 'A level, or a list of levels, to keep: "error" answers with the errors only. ' +
    'A read with this or `term` is a scan: the whole file, or the range, is read and the newest ' +
    '`limit` matching entries are the answer, so a match far back in the file is still found. ' +
    'Without either, the answer is the newest window of bytes, as a viewer opens it.',
}

const logTermInput = {
  type: 'string',
  description: 'A word or phrase an entry has to contain, in any case and anywhere in it — its ' +
    'time, level, message or details. Like `level`, it turns the read into a scan of the range.',
}

const logLimitInput = {
  type: 'integer',
  minimum: 1,
  maximum: 500,
  description: 'How many matching entries to answer with, newest last: 100 by default. Only a ' +
    'read with `level` or `term` uses it.',
}

const logBytesInput = {
  type: 'integer',
  minimum: 1024,
  maximum: 2 * 1024 * 1024,
  description: 'How wide the window is, in bytes: 32 KB by default. Only a read without ' +
    '`level`/`term` uses it.',
}

const logBeforeInput = {
  type: 'integer',
  minimum: 0,
  description: 'A byte offset of the file to end a window at. Pass the `from` of a window to ' +
    'read the page before it.',
}

const logAfterInput = {
  type: 'integer',
  minimum: 0,
  description: 'A byte offset of the file to start a window at. Pass the `to` of a window to ' +
    'read the page after it.',
}

const errorOutput = {
  type: ['object', 'null'],
  description: 'The exception that stopped the run, when one did.',
  properties: {class: {type: 'string'}, message: {type: 'string'}},
}

const logEntryOutput = {
  type: 'object',
  properties: {
    at: {type: ['string', 'null'], description: 'When the entry was written, as the file wrote it.'},
    environment: {type: ['string', 'null'], description: 'The channel the entry was written on.'},
    level: {type: ['string', 'null'], description: 'The level, in lowercase. Null for a line that belongs to no entry.'},
    message: {type: 'string'},
    details: {type: 'string', description: 'The context and the stack trace under the message.'},
  },
}

const logReadOutput = {
  type: 'object',
  properties: {
    connection: {type: 'string'},
    file: {type: 'string'},
    size: {type: 'integer', description: 'How big the file is, in bytes.'},
    from: {type: 'integer', description: 'The byte the answer starts at.'},
    to: {type: 'integer', description: 'The byte it ends at.'},
    read: {type: 'integer', description: 'How many bytes were read.'},
    range: {
      type: 'object',
      description: 'The bytes the `since`/`until` range covers, when one was given.',
      properties: {from: {type: 'integer'}, to: {type: 'integer'}},
    },
    filtered: {type: 'boolean', description: 'Whether the answer is a scan of the range rather than a window onto it.'},
    entries: {type: 'array', items: logEntryOutput},
    older: {
      type: 'integer',
      description: 'How many matching entries were older than the ones answered with.',
    },
    error: errorOutput,
  },
}

const runOutput = {
  type: 'object',
  properties: {
    value: {description: 'What the last statement answered, as data.'},
    blocks: {
      type: 'array',
      description: 'What every statement answered, in the order they ran.',
      items: {
        type: 'object',
        properties: {
          line: {type: 'number'},
          value: {},
          error: errorOutput,
        },
      },
    },
    error: errorOutput,
    output: {type: 'string', description: 'What the code printed.'},
    imported: {
      type: 'object',
      description: 'The classes the run aliased by their short name, when it aliased any.',
    },
    transaction: {
      type: ['object', 'null'],
      description: 'What a dry run (`guard: "rollback"`) did with its transaction: whether it was ' +
        'armed, how it ended (rolledBack, broken, failed), why, and the statements that were ' +
        'sent outside it.',
      properties: {
        mode: {type: 'string'},
        armed: {type: 'boolean'},
        connection: {type: ['string', 'null']},
        statements: {type: 'number'},
        outcome: {type: 'string'},
        error: {type: ['string', 'null']},
        unguarded: {type: 'object'},
      },
    },
    cut: {
      type: 'array',
      description: 'The parts of the answer that were too big to hand back whole.',
      items: {type: 'string'},
    },
  },
}

const TOOLS = [
  {
    name: 'tinkr_documentation',
    title: 'How Tinkr works, and how to use these tools',
    description: 'Read what Tinkr is: how a run works, what the two guards (a dry run, and a ' +
      'sandboxed one that also holds mail, jobs, HTTP calls, file writes, the cache and the log) ' +
      'do and when to use which, what a connection is and what the production tag changes, every ' +
      'tool this server exposes, and how to read the answer. Read this before running code you ' +
      'did not write, and before running anything on a production connection.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: [...topics.map(one => one.name), 'all'],
          description: 'Which part to read: ' + topics.map(one => `"${one.name}" (${one.summary})`).join(', ') +
            ', or "all" for every one of them. The overview when it is not given.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tinkr_run_php',
    title: 'Run PHP in a project',
    description: 'Run PHP in a project on this machine, or in a Laravel Cloud environment, in ' +
      'that project\'s own Tinker session, ' +
      'and answer with what every statement returned and what the code printed. The session ' +
      'is booted for the call, so the code on disk is the code that runs, and the code runs ' +
      'with the project booted: its classes, its configuration, its database. Every statement ' +
      'is evaluated in order and the run stops at the first one that throws. Pass ' +
      '`guard: "rollback"` for a dry run. A Laravel Cloud connection is sent as one command ' +
      'to the environment it names, which is a container Laravel Cloud runs: nothing is booted ' +
      'here, and a run that is stopped keeps running there until it ends. ' + productionRule,
    annotations: {readOnlyHint: false, destructiveHint: true, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The PHP to run, written as it would be typed into tinker. A leading ' +
            '`<?php` is allowed.',
        },
        path: {
          type: 'string',
          description: 'The project directory to run in, when it is not the one this server was ' +
            'started in.',
        },
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr, when the code should run ' +
            'in that one. A Laravel Cloud connection runs in the environment it names. A ' +
            'connection over ssh is refused here: use tinkr_run_php_over_ssh.',
        },
        guard: guardInput,
        timeout_ms: timeoutInput,
      },
      required: ['code'],
      additionalProperties: false,
    },
    outputSchema: runOutput,
  },
  {
    name: 'tinkr_run_php_over_ssh',
    title: 'Run PHP on a server',
    description: 'Run PHP on a server, through one of Tinkr\'s saved ssh connections, in the ' +
      'session that connection runs (`php artisan tinker` by default). The connection is opened ' +
      'for the call and closed when it answers. What runs is code on someone else\'s machine: ' +
      'read it before it runs, and pass `guard: "rollback"` for a dry run. ' + productionRule,
    annotations: {readOnlyHint: false, destructiveHint: true, openWorldHint: true},
    inputSchema: {
      type: 'object',
      properties: {
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr that runs over ssh.',
        },
        code: {type: 'string', description: 'The PHP to run, written as it would be typed into tinker.'},
        guard: guardInput,
        timeout_ms: timeoutInput,
      },
      required: ['connection', 'code'],
      additionalProperties: false,
    },
    outputSchema: runOutput,
  },
  {
    name: 'tinkr_list_history',
    title: 'List the runs the app kept',
    description: 'List the runs Tinkr has kept for a connection, newest first: the code that ran, ' +
      'when, and how it ended. It is the app\'s own history: the runs made in the app\'s window. ' +
      'Runs made through this server are not added to it. Read one of them to see what came back.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr. The connection this ' +
            'server was started on when it is not given.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'How many runs to list, newest first. Ten by default, fifty at most.',
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        connection: {type: 'string'},
        runs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: {type: 'string'},
              at: {type: ['string', 'null'], description: 'when the run started, in ISO 8601'},
              outcome: {type: ['string', 'null'], description: 'returned, printed or threw'},
              code: {type: 'string'},
            },
          },
        },
        error: errorOutput,
      },
    },
  },
  {
    name: 'tinkr_read_run',
    title: 'Read one kept run',
    description: 'Read one run from a connection\'s history in full: the code that ran, when, what ' +
      'it returned, what it printed, and the exception it threw. A run answers with as much of ' +
      'itself as the app keeps — where that is not the whole answer, the parts that were too big ' +
      'are named, and the code can be run again for the whole thing.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        id: {type: 'string', description: 'The id of the run, as the history lists it.'},
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr. The connection this ' +
            'server was started on when it is not given.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        at: {type: ['string', 'null']},
        outcome: {type: ['string', 'null']},
        code: {type: 'string'},
        value: {description: 'What the run returned, when the entry kept it.'},
        error: errorOutput,
        output: {type: 'string', description: 'What the run printed, when the entry kept it.'},
        cut: {
          type: 'array',
          description: 'The parts of the answer that were too big to keep.',
          items: {type: 'string'},
        },
      },
    },
  },
  {
    name: 'tinkr_list_logs',
    title: 'The log files of a connection',
    description: 'List the log files of a connection, newest first: the name of each, how big ' +
      'it is and when it was last written. They are the project\'s own logs — `storage/logs` ' +
      'unless the app\'s preferences say otherwise — read on the machine the project runs on: ' +
      'here for a local or container connection, and over ssh for a server one. A Laravel ' +
      'Cloud connection has no log files this server can read, and says so.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: true},
    inputSchema: {
      type: 'object',
      properties: {connection: connectionInput},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        connection: {type: 'string'},
        dir: {type: 'string', description: 'Where the logs were looked for, as that machine spells it.'},
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: {type: 'string'},
              size: {type: 'integer'},
              at: {type: ['string', 'null'], description: 'When it was last written, in ISO 8601.'},
            },
          },
        },
        error: errorOutput,
      },
    },
  },
  {
    name: 'tinkr_tail_logs',
    title: 'Read a connection\'s logs',
    description: 'Read the end of one of a connection\'s log files: the newest window of bytes, ' +
      'as the app\'s log viewer opens one, and the entries it holds — one per line that starts ' +
      'one, with its context and stack trace under it. The file is never read whole: the window ' +
      'is the newest 32 KB by default, and `before` reads the page before it. `since` and ' +
      '`until` narrow the read to a range of moments, found in the file itself. A `level` or a ' +
      '`term` turns the read into a scan of the whole range instead, answering with the newest ' +
      '`limit` entries that match — which is how a rare error far back in a large file is found. ' +
      'Reading is allowed on any connection, production included: it reads a file and runs ' +
      'nothing of yours.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: true},
    inputSchema: {
      type: 'object',
      properties: {
        connection: connectionInput,
        file: logFileInput,
        bytes: logBytesInput,
        before: logBeforeInput,
        after: logAfterInput,
        since: logSinceInput,
        until: logUntilInput,
        level: logLevelInput,
        term: logTermInput,
        limit: logLimitInput,
      },
      additionalProperties: false,
    },
    outputSchema: logReadOutput,
  },
  {
    name: 'tinkr_list_connections',
    title: 'List the saved connections',
    description: 'List the connections saved in Tinkr: the directories and the servers the app ' +
      'runs code in, with the command each session is started with. A Laravel Cloud connection ' +
      'is listed with the application and environment it was saved with instead: it has no ' +
      'command and no server, and its code runs inside an environment Laravel Cloud owns.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
  },
  {
    name: 'tinkr_list_snippets',
    title: 'List the saved snippets',
    description: 'List the snippets saved in Tinkr for a connection: the code that was kept, ' +
      'with the name it was given. A snippet is what the app shows in its sidebar.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr. The connection this ' +
            'server was started on when it is not given.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tinkr_save_snippet',
    title: 'Save a snippet',
    description: 'Save code in Tinkr as a snippet of a connection, so that the app has it the ' +
      'next time it starts.',
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        code: {type: 'string', description: 'The code to keep.'},
        name: {type: 'string', description: 'The name the snippet is listed under.'},
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr. The connection this ' +
            'server was started on when it is not given.',
        },
      },
      required: ['code', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'tinkr_delete_snippet',
    title: 'Delete a snippet',
    description: 'Delete a snippet of a connection from Tinkr, by its id. The ids are what ' +
      'tinkr_list_snippets answers with. A snippet that is already gone is not an error: ' +
      'the answer says it was gone.',
    annotations: {readOnlyHint: false, destructiveHint: true, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        id: {type: 'string', description: 'The id of the snippet, as tinkr_list_snippets lists it.'},
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr. The connection this ' +
            'server was started on when it is not given.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
]

// the shape a moment is given in, which is the shape a log stamps its entries in
const momentShape = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/**
 * A number an argument has to be: a byte offset, a width, a count.
 *
 * @param {String} name the argument
 * @param {any} value
 * @return {Number}
 */
const countOf = (name, value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`\`${name}\` has to be a number, 0 or more: ${target.said(value)} is not one.`)
  }

  return Math.floor(value)
}

/**
 * A moment an argument has to be, written as a log writes one.
 *
 * @param {String} name the argument
 * @param {any} value
 * @return {String}
 */
const momentOf = (name, value) => {
  if (typeof value !== 'string' || !momentShape.test(value.trim())) {
    throw new Error(`\`${name}\` has to be a moment written as "2026-08-27 11:10:52": ` +
      `${target.said(value)} is not one.`)
  }

  return value.trim()
}

/**
 * What a read of a log is asked for, out of the arguments of a call.
 *
 * The width is the one the app's viewer reads a page with, because an answer is
 * read by a model and 32 KB of log lines is already a great deal of them.
 *
 * @param {Object} args
 * @return {{options: Object, filtered: Boolean}} `filtered` says the answer will be
 *   a scan of the range rather than a window onto it
 */
const logOptionsOf = args => {
  const options = {}

  if (args.bytes !== undefined) {
    options.bytes = countOf('bytes', args.bytes)
  }

  if (args.before !== undefined) {
    options.before = countOf('before', args.before)
  }

  if (args.after !== undefined) {
    options.after = countOf('after', args.after)
  }

  if (args.since !== undefined) {
    options.since = momentOf('since', args.since)
  }

  if (args.until !== undefined) {
    options.until = momentOf('until', args.until)
  }

  if (args.level !== undefined) {
    const listed = Array.isArray(args.level) ? args.level : [args.level]

    if (listed.length === 0 || listed.some(one => typeof one !== 'string')) {
      throw new Error('`level` has to be a level, or a list of them: "error", or ["error", "critical"].')
    }

    options.level = args.level
  }

  if (args.term !== undefined) {
    if (typeof args.term !== 'string') {
      throw new Error('`term` has to be a string: the word or phrase an entry has to contain.')
    }

    options.term = args.term
  }

  if (args.limit !== undefined) {
    options.limit = countOf('limit', args.limit)
  }

  if (options.bytes === undefined) {
    options.bytes = 32 * 1024
  }

  // what the reader will do with these is the reader's own rule, so it is asked
  // rather than guessed at: an empty term is no filter, and a level a log does
  // not have is refused here rather than answering as if it matched nothing
  const levels = logReader.levelsOf(options.level)
  const term = typeof options.term === 'string' ? options.term.trim() : ''

  if (term === '') {
    delete options.term
  }

  return {options, filtered: levels.length > 0 || term !== ''}
}

/**
 * The file a call reads, and what the connection has, so that a call that named
 * no file is answered with the newest one.
 *
 * @param {Object} found the resolved target
 * @param {any} wanted the `file` argument
 * @param {Object} settings
 * @return {Promise<{file: String|null, dir: String}>}
 */
const logChoiceOf = async (found, wanted, settings) => {
  if (wanted !== undefined && typeof wanted !== 'string') {
    throw new Error('`file` has to be the name of a log file, as tinkr_list_logs lists it.')
  }

  const listed = await logReader.files(found.connection, settings)
  const named = typeof wanted === 'string' ? wanted.trim() : ''

  return {
    file: named === '' ? (((listed.files || [])[0] || {}).name || null) : named,
    dir: listed.dir,
  }
}

/**
 * What the reader needs from the app: where it keeps its logs, and where its own
 * data is.
 *
 * @param {Object} found the resolved target
 * @return {{logDir: String, dataDir: String|null}}
 */
const logSettingsOf = found => ({
  logDir: found.dataDir ? app.logDir(found.dataDir) : logReader.defaultDir,
  dataDir: found.dataDir || null,
})

/**
 * The entries of a read, cut to what an answer may carry: the newest ones are
 * what a log is read for, so the oldest go first.
 *
 * @param {Array<Object>} entries
 * @return {Array<Object>}
 */
const boundEntries = entries => {
  const kept = []
  let used = 0

  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const cost = JSON.stringify(entries[at]).length

    if (used + cost > maxText) {
      break
    }

    used += cost
    kept.unshift(entries[at])
  }

  return kept
}

/**
 * The server's tools, over a target and a way to run code in it.
 *
 * @param {{target: Object, version: String, timeout?: Number, run?: Function,
 *   log?: Object, pinned?: Boolean, allowProduction?: Boolean,
 *   command?: String}} options `target` is target.resolve's answer, `run` is what
 *   actually runs the code, and is replaced in a test. `pinned` says the target
 *   was named with --connection, `allowProduction` that the server was started
 *   with --allow-production, and `command` is the --command it was given
 * @return {{tools: Array, call: Function, instructions: String}}
 */
const createServer = ({
  target: resolved,
  version,
  timeout = 60000,
  run = runCode,
  log = console,
  pinned = false,
  allowProduction = false,
  command = null,
}) => {
  // the connection a production run is let through to without
  // --allow-production: the one the server was started on by name, which is a
  // choice someone made for this server rather than one a client makes per call
  const pinnedId = pinned && resolved.saved ? resolved.connection.id : null

  /**
   * @param {Object} connection
   * @param {String} code
   * @param {{timeout: Number, guard: String|null, signal?: AbortSignal}} options
   * @return {Promise<Object>}
   */
  const execute = (connection, code, {timeout: ms, guard, signal}) => run(connection, code, {
    timeout: ms,
    command: connection.command,
    guard,
    signal,
    appName: 'Tinkr',
    appVersion: version,
    log,
    // where the app's data is, which is where a connection's saved password is:
    // an agent runs the same connection the window does, and logs in the same way
    dataDir: resolved.dataDir,
  })

  /**
   * The connection a tool call names, or the one this server was started on.
   *
   * A connection named on the call is that connection, with its own command (or
   * the app's preference when it names none). The server's own --command is the
   * command of what the server was started on, and of a directory named on the
   * call that the app has no connection for, which has no command of its own.
   *
   * @param {Object} args
   * @return {Object} the resolved target
   */
  const lookup = args => {
    for (const field of ['connection', 'path']) {
      if (args[field] !== undefined && typeof args[field] !== 'string') {
        throw new Error(`\`${field}\` has to be a string.`)
      }
    }

    if (!args.connection && !args.path) {
      return resolved
    }

    const found = target.resolve({connection: args.connection, at: args.path, dataDir: resolved.dataDir})

    if (resolved.saved && found.saved && found.connection.id === resolved.connection.id) {
      return resolved
    }

    if (!found.saved && command) {
      return Object.assign({}, found, {connection: Object.assign({}, found.connection, {command})})
    }

    return found
  }

  /**
   * The connection a run goes to, once it is one this tool runs in and one this
   * server is let run in.
   *
   * @param {Object} args
   * @param {Boolean} overSsh whether the tool is the ssh one
   * @return {Object}
   */
  const runTargetOf = (args, overSsh) => {
    const named = Boolean(args.connection || args.path)
    const found = lookup(args)
    const {connection} = found
    const remote = Boolean(connection.is_over_ssh)

    if (remote !== overSsh) {
      // a cloud connection is neither: it runs in an environment Laravel Cloud
      // owns, and naming it as one that runs here would be a wrong answer to the
      // question the caller is asking
      const where = connection.is_cloud ? 'runs on Laravel Cloud' : (remote ? 'runs over ssh' : 'runs on this machine')
      const tool = connection.is_cloud ? 'tinkr_run_php' : (remote ? 'tinkr_run_php_over_ssh' : 'tinkr_run_php')

      if (!named) {
        throw new Error(overSsh
          ? `This server was started on ${connection.name}, which ${where}. ` +
            'Name a connection that runs over ssh.'
          : `This server was started on ${connection.name}, which ${where}. ` +
            `Use ${tool}.`)
      }

      throw new Error(`${connection.name} ${where}. Use ${tool}.`)
    }

    if (connection.tag === 'production' && !allowProduction && !(found.saved && connection.id === pinnedId)) {
      throw new Error(
        `${connection.name} is tagged production, and this server does not run code there: it runs ` +
        'code in a production connection only when it was started on that connection ' +
        '(--connection) or with --allow-production.',
      )
    }

    // a directory that is not there would boot the session in the home
    // directory instead, where there is no project to run in. A cloud
    // connection boots nothing here: its path is an optional local checkout for
    // class names, and a run goes to Laravel Cloud with or without one
    if (!remote && !connection.is_cloud) {
      let directory = false

      try {
        directory = fs.statSync(connection.path).isDirectory()
      } catch (e) {
      }

      if (!directory) {
        throw new Error(`${target.said(connection.path)} is not a directory on this machine, so there is no project to run in.`)
      }
    }

    return found
  }

  /**
   * The connection a snippet or a run of the history belongs to, which has to
   * be one the app knows: a directory the app has no connection for has neither.
   *
   * @param {Object} args
   * @param {String} what what the app keeps for a connection, as a phrase
   * @return {Object}
   */
  const knownConnectionOf = (args, what) => {
    const found = lookup(args)

    if (!found.saved) {
      throw new Error(
        `Tinkr has no connection for ${found.connection.path}, so it has no ${what}. ` +
        'Add the directory as a connection in the app first, or name one with `connection`.',
      )
    }

    return found
  }

  /**
   * @param {Object} args
   * @param {Boolean} overSsh
   * @param {AbortSignal} [signal]
   * @return {Promise<Object>}
   */
  const runTool = async (args, overSsh, signal) => {
    const code = codeOf(args)
    const guard = guardOf(args)
    const found = runTargetOf(args, overSsh)
    const result = await execute(found.connection, code, {timeout: timeoutOf(args, timeout), guard, signal})

    if (result && result.error && result.error.class === 'SessionError') {
      return sessionFailure(result)
    }

    return answer(result, guard)
  }

  /**
   * @param {String} name
   * @param {Object} args
   * @param {AbortSignal} [signal]
   * @return {Promise<Object>}
   */
  const handle = async (name, args, signal) => {
    switch (name) {
      case 'tinkr_run_php':
        return runTool(args, false, signal)

      case 'tinkr_run_php_over_ssh':
        return runTool(args, true, signal)

      case 'tinkr_list_history': {
        const found = knownConnectionOf(args, 'history')
        const limit = limitOf(args)
        // the app keeps its runs newest first, and a slice of a list that was
        // written some other way would be the wrong runs. An entry whose time
        // cannot be read goes last, in the order the file has it
        const runs = app.history(found.dataDir, found.connection.id)
          .map(entry => ({entry, time: timeOf(entry.at)}))
          .sort((one, other) => (other.time === null ? -Infinity : other.time) - (one.time === null ? -Infinity : one.time) || 0)
          .slice(0, limit)
          .map(({entry}) => ({
            id: String(entry.id === undefined || entry.id === null ? '' : entry.id),
            at: isoOf(entry.at),
            outcome: typeof entry.outcome === 'string' ? entry.outcome : null,
            code: typeof entry.code === 'string' ? entry.code : '',
          }))

        return {
          content: [{
            type: 'text',
            text: truncate(runs.length
              ? runs.map(run => [
                `${run.at || 'at an unknown time'} · ${run.outcome || 'unknown outcome'} · ${run.id}`,
                truncate(run.code, 500),
              ].join('\n')).join('\n\n')
              : 'This connection has run nothing yet.'),
          }],
          structuredContent: {
            connection: found.connection.id,
            // the list is a scan of what ran: each run's code is cut as the text
            // cuts it, and read whole with tinkr_read_run
            runs: runs.map(run => Object.assign({}, run, {code: truncate(run.code, 4000)})),
          },
          isError: false,
        }
      }

      case 'tinkr_read_run': {
        if (typeof args.id !== 'string' || args.id.trim() === '') {
          throw new Error('`id` is required: the id of the run, as the history lists it.')
        }

        const found = knownConnectionOf(args, 'history')
        const entry = app.history(found.dataDir, found.connection.id)
          .find(one => one.id === args.id)

        if (!entry) {
          throw new Error(
            `No run with the id ${target.said(args.id)} is kept for ${found.connection.name}. ` +
            'List the history for the ids of the runs that are.',
          )
        }

        const read = {
          id: entry.id,
          at: isoOf(entry.at),
          outcome: typeof entry.outcome === 'string' ? entry.outcome : null,
          code: typeof entry.code === 'string' ? entry.code : '',
          error: errorOf(entry.error),
        }

        if (entry.value !== undefined) {
          read.value = entry.value
        }

        if (typeof entry.output === 'string') {
          read.output = entry.output
        }

        if (Array.isArray(entry.cut)) {
          read.cut = entry.cut.map(String)
        }

        const bounded = bound(read)

        if (bounded.code.length > maxText) {
          bounded.code = truncate(bounded.code)
        }

        return {
          content: [{type: 'text', text: renderRun(entry)}],
          structuredContent: bounded,
          isError: false,
        }
      }

      case 'tinkr_list_logs': {
        const found = lookup(args)
        const {dir, files} = await logReader.files(found.connection, logSettingsOf(found))
        const listed = files.map(one => ({name: one.name, size: one.size, at: isoOf(one.at)}))

        const head = `${listed.length} log ${listed.length === 1 ? 'file' : 'files'} in ${dir}, newest first:`
        const lines = listed.length
          ? [head, ''].concat(listed.map(one => `${one.name} · ${bytesOf(one.size)} · ${one.at || 'at an unknown time'}`))
          : [`No log files are in ${dir}.`]

        return {
          content: [{type: 'text', text: truncate(lines.join('\n'))}],
          structuredContent: {connection: found.connection.id, dir, files: listed},
          isError: false,
        }
      }

      case 'tinkr_tail_logs': {
        const found = lookup(args)
        const settings = logSettingsOf(found)
        const {options, filtered} = logOptionsOf(args)
        const {file, dir} = await logChoiceOf(found, args.file, settings)

        if (file === null) {
          return {
            content: [{
              type: 'text',
              text: `No log files are in ${dir}, so there is nothing to read.`,
            }],
            structuredContent: {
              connection: found.connection.id,
              file: '',
              size: 0,
              from: 0,
              to: 0,
              read: 0,
              filtered,
              entries: [],
            },
            isError: false,
          }
        }

        const answer = await logReader.read(found.connection, file, options, settings)
        const all = Array.isArray(answer.entries) ? answer.entries : []
        const entries = boundEntries(all)
        // a read that answered with more matches than it kept is a read whose
        // older matches are still in the file, and the answer says how many
        const older = Math.max(Number(answer.older) || 0, 0) + (all.length - entries.length)
        // a window says how much of it was read rather than where it ends; a
        // scan says both, because what it read is the region it walked
        const to = typeof answer.to === 'number' ? answer.to : answer.from + answer.read
        const read = Object.assign({}, answer, {file, filtered, entries, older, to})
        const structured = {
          connection: found.connection.id,
          file,
          size: read.size,
          from: read.from,
          to,
          read: read.read,
          filtered,
          entries,
        }

        if (read.range) {
          structured.range = read.range
        }

        if (filtered) {
          structured.older = older
        }

        return {
          content: [{type: 'text', text: truncate(renderLogs(read))}],
          structuredContent: structured,
          isError: false,
        }
      }

      case 'tinkr_documentation': {
        const answer = documentation(args.topic)

        return {
          content: [{type: 'text', text: answer.text}],
          structuredContent: {topic: answer.topic, title: answer.title, text: truncate(answer.text)},
          isError: false,
        }
      }

      case 'tinkr_list_connections': {
        const connections = resolved.dataDir ? app.connections(resolved.dataDir).map(connectionInfo) : []

        return {
          content: [{
            type: 'text',
            text: resolved.dataDir
              ? json(connections)
              : 'Tinkr\'s own data was not found, so there are no saved connections to list.',
          }],
          structuredContent: {connections},
          isError: false,
        }
      }

      case 'tinkr_list_snippets': {
        const found = knownConnectionOf(args, 'snippets')
        const snippets = app.snippets(found.dataDir, found.connection.id)
          .map(snippet => ({id: snippet.id, name: snippet.name || null, code: snippet.code}))

        return {
          content: [{type: 'text', text: snippets.length ? truncate(json(snippets)) : 'No snippets saved for this connection.'}],
          structuredContent: {connection: found.connection.id, snippets},
          isError: false,
        }
      }

      case 'tinkr_save_snippet': {
        if (typeof args.name !== 'string' || args.name.trim() === '') {
          throw new Error('`name` is required: what the snippet is listed under.')
        }

        const code = codeOf(args)
        const found = knownConnectionOf(args, 'snippets to keep')
        const snippet = app.saveSnippet(found.dataDir, found.connection.id, args.name, code)

        return {
          content: [{
            type: 'text',
            text: `Saved "${target.said(args.name)}" as a snippet of ${found.connection.name} (${snippet.id}).`,
          }],
          structuredContent: {snippet: Object.assign({}, snippet, {code: truncate(snippet.code)})},
          isError: false,
        }
      }

      case 'tinkr_delete_snippet': {
        if (typeof args.id !== 'string' || args.id.trim() === '') {
          throw new Error('`id` is required: the id of the snippet, as tinkr_list_snippets lists it.')
        }

        const found = knownConnectionOf(args, 'snippets to delete')
        const result = app.deleteSnippet(found.dataDir, found.connection.id, args.id)

        return {
          content: [{
            type: 'text',
            text: result.deleted
              ? `Deleted ${result.name === null ? 'the snippet' : `"${target.said(result.name)}"`} from ${found.connection.name}.`
              : `No snippet with the id ${target.said(args.id)} is kept for ${found.connection.name}, so nothing was deleted.`,
          }],
          structuredContent: Object.assign({connection: found.connection.id}, result),
          isError: false,
        }
      }

      default:
        // the protocol layer looks the tool up before it gets here, so a name
        // with no case is a server that was asked for a tool it does not have
        throw Object.assign(new Error(`Unknown tool: ${target.said(name)}`), {code: -32602})
    }
  }

  /**
   * @param {String} name
   * @param {Object} args
   * @param {{signal?: AbortSignal}} [options] `signal` is aborted when the client
   * cancels the call, and a run that is still going is stopped
   * @return {Promise<Object>} what the tool answers with. A tool that throws is
   * an answer with `isError`, because the caller has to read what went wrong
   */
  const call = async (name, args = {}, {signal} = {}) => {
    try {
      return await handle(name, args, signal)
    } catch (e) {
      if (e.code === -32602) {
        throw e
      }

      return failure(e)
    }
  }

  return {
    tools: TOOLS,
    call,
    instructions: 'Tinkr runs PHP in a project, the way a developer would at a terminal: the ' +
      'project is booted, so its framework, its classes and its database are there. Code runs ' +
      'in a session of its own that is booted and closed for the call. It is code: it can ' +
      'change or delete what the project holds. To see what code would change without keeping ' +
      'it, run it with `guard: "rollback"`. ' + productionRule,
  }
}

module.exports = {
  TOOLS,
  render,
  renderRun,
  bound,
  connectionInfo,
  createServer,
  maxText,
}
