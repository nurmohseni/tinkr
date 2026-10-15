/**
 * The ansi-regex pattern: everything the terminal inserts while it renders what
 * the session prints (colors, the soft wraps written as `ESC[m \b`).
 *
 * (the ansi-regex pattern)
 */
// eslint-disable-next-line no-control-regex
const ansi = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

/**
 * The soft wraps the terminal writes are `ESC[m \b`: once the escape is gone,
 * the backspace deletes the space that was written with it, so the stream has
 * to be read the way the terminal shows it.
 *
 * @param {String} value
 * @return {String}
 */
const backspaces = value => {
  const chars = []

  for (const char of value) {
    if (char === '\b') {
      chars.pop()
      continue
    }

    chars.push(char)
  }

  return chars.join('')
}

/**
 * What the terminal shows, without what it needed to show it.
 *
 * @param {String} value
 * @return {String}
 */
const stripRendering = value => backspaces(value.replace(ansi, ''))

/**
 * Where psysh evaluated the code, which it appends to what the code printed:
 *
 *   ] // vendor/psy/psysh/src/ExecutionLoopClosure.php(55) : eval()'d code:2
 *
 * That is the session talking about itself rather than anything the run said,
 * so it is dropped from what the run printed. The shape is psysh's own and is
 * matched closely: `psy/psysh` on a ` // ` comment carrying a line number and
 * the eval it came from.
 */
const psyshNote = / \/\/ [^\n]*psy\/psysh[^\n]*\(\d+\)[^\n]*eval\(\)'d code[^\n]*/g

/**
 * What a run printed, without what the session added around it.
 *
 * @param {String} value
 * @return {String}
 */
const stripSessionNotes = value => stripRendering(value).replace(psyshNote, '')

module.exports = {
  stripRendering,
  stripSessionNotes,
}
