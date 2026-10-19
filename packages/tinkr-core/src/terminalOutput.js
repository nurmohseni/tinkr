/**
 * The ansi-regex pattern: everything the terminal inserts while it renders what
 * the session prints (colors, the soft wraps written as `ESC[m \b`).
 *
 * (the ansi-regex pattern)
 */
// eslint-disable-next-line no-control-regex
const ansi = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

/**
 * The operating system commands: `ESC ] <code>;<text>` ended by a bell or by
 * `ESC \`. A shell's prompt, its title and the shell integration's `3008`
 * context markers are all written this way, and the ansi pattern above does not
 * read them: it reads an `ESC ]` as a colour and leaves the payload behind as if
 * it were output.
 *
 * The payload is matched up to its own terminator rather than by its length,
 * because a title or a working directory is as long as it is.
 */
// eslint-disable-next-line no-control-regex
const osc = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g

/**
 * The soft wraps the terminal writes are `ESC[m \b`: once the escape is gone,
 * the backspace deletes the space that was written with it, so the stream has
 * to be read the way the terminal shows it.
 *
 * A value can be tens of megabytes, and an array of one character per byte is
 * both slow and, past about 120 million entries, more than node will allocate.
 * So the string is walked in pieces: each piece is kept as it is until it holds
 * a backspace, and a piece that deletes its way back past its own start deletes
 * into what has already been kept, which is the only case that has to reach
 * back. That keeps the common case — no backspace at all — one string and no
 * array.
 *
 * @param {String} value
 * @return {String}
 */
const backspaces = value => {
  if (value.indexOf('\b') === -1) {
    return value
  }

  const pieces = []
  const size = 1 << 16

  for (let at = 0; at < value.length; at += size) {
    let piece = value.slice(at, at + size)
    const at8 = piece.indexOf('\b')

    if (at8 === -1) {
      pieces.push(piece)
      continue
    }

    // this piece deletes: it is walked as characters, and a backspace at its
    // start reaches back into the pieces before it
    const chars = []

    for (const char of piece) {
      if (char === '\b') {
        if (chars.length) {
          chars.pop()
        } else if (pieces.length) {
          // the pieces before it are whole strings, and what is deleted is the
          // last character of them, which may be two code units wide
          const last = pieces.pop()
          const kept = [...last]

          kept.pop()
          pieces.push(kept.join(''))
        }

        continue
      }

      chars.push(char)
    }

    piece = chars.join('')

    if (piece) {
      pieces.push(piece)
    }
  }

  return pieces.join('')
}

/**
 * What the terminal shows, without what it needed to show it.
 *
 * @param {String} value
 * @return {String}
 */
const stripRendering = value => backspaces(value.replace(osc, '').replace(ansi, ''))

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
