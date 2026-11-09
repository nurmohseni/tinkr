/**
 * The facts a run answers about itself besides its value: how it ended when it
 * ended on purpose, and what it spent.
 *
 * Both are said in more than one place — the pane's own head and the Markdown
 * block it can be copied as — and both are sentences of the app's language, so
 * they are built once here rather than twice with a chance to drift. The words
 * are the message catalogue's; nothing here decides a word the app has not.
 */

/**
 * The bytes a run peaked at, as the unit a person reads them in.
 *
 * A kilobyte is the smallest figure worth saying, and a megabyte is what most
 * runs that hold anything are measured in.
 *
 * @param {IntlShape} intl
 * @param {Number} memory bytes
 * @return {String|null} null when the envelope has no measurement
 */
export const memoryLabel = (intl, memory) => {
  const size = Number(memory)

  if (!Number.isFinite(size) || size <= 0) {
    return null
  }

  return size >= 1024 * 1024
    ? intl.formatMessage({id: 'result.memory_mb'}, {size: (size / 1048576).toFixed(1)})
    : intl.formatMessage({id: 'result.memory_kb'}, {size: Math.max(1, Math.round(size / 1024))})
}

/**
 * What the snippet spent, in one line: its own php time and the memory it peaked
 * at — not the wall clock, which is the wait around it.
 *
 * @param {IntlShape} intl
 * @param {Object} stats `{time, memory}` from the envelope
 * @return {String|null}
 */
export const statsLine = (intl, stats) => {
  const time = Number(stats && stats.time)
  const memory = stats ? memoryLabel(intl, stats.memory) : null

  if (!Number.isFinite(time) || time < 0 || memory === null) {
    return null
  }

  return intl.formatMessage({id: 'result.stats'}, {time: Math.round(time), memory})
}

/**
 * The function a run ended through, written as php writes it.
 *
 * `exit` is what the envelope says for both `exit()` and `die()`: they are one
 * construct, and the envelope does not pretend to know which spelling the
 * snippet used.
 *
 * @param {Object} ended
 * @return {String}
 */
export const endingCall = ended => (ended && ended.by === 'dd' ? 'dd()' : 'exit()')

/**
 * What a run that ended on purpose says: which call stopped it, and on which
 * line of the snippet.
 *
 * @param {IntlShape} intl
 * @param {Object} ended `{by, line}` from the envelope
 * @return {String}
 */
export const endingSentence = (intl, ended) => {
  const line = Number(ended && ended.line)
  const call = endingCall(ended)

  return Number.isInteger(line) && line > 0
    ? intl.formatMessage({id: 'result.ended_func_line'}, {call, line})
    : intl.formatMessage({id: 'result.ended_func'}, {call})
}
