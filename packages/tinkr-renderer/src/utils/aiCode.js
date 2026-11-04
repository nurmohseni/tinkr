/**
 * A snippet turned into the lines and the coloured runs the panel draws.
 *
 * The colours are the ones the design already paints code with — the `c-*`
 * classes of tinkr.css, which are the tokens monaco's own theme is built from —
 * so a snippet in the panel and the same code in the editor are one colour.
 *
 * The mapping is by the head of monaco's token type: the php-snippet grammar
 * emits `keyword.php`, `string.escape.php`, `number.hex.php` and the rest, and
 * the head is what says which class a run is.
 */

const CLASSES = [
  [/^keyword(\.|$)/, 'c-keyword'],
  // true, false, null and the compile-time constants, which the grammar emits
  // as constant.php
  [/^constant(\.|$)/, 'c-const'],
  [/^number(\.|$)/, 'c-num'],
  [/^string(\.|$)/, 'c-str'],
  [/^comment(\.|$)/, 'c-comment'],
  [/^variable(\.|$)/, 'c-var'],
  [/^delimiter(\.|$)/, 'c-op'],
  // the grammar does not tell a method name from a class name, and the editor
  // paints both with --code-fn
  [/^identifier(\.|$)/, 'c-fn'],
]

/**
 * @param {String} type a monaco token type, such as `string.escape.php`
 * @return {String} the design's class for it, or '' for nothing in particular
 */
export const tokenClass = type => {
  const found = CLASSES.find(([pattern]) => pattern.test(String(type || '')))

  return found ? found[1] : ''
}

const offsetOf = (token, fallback) => {
  const offset = Number(token && token.offset)

  return Number.isFinite(offset) && offset >= 0 ? offset : fallback
}

/**
 * The lines of a snippet, each one the runs it is made of.
 *
 * Every line is read from its own offset onwards, so the runs of a line always
 * add up to the line itself: a tokenizer that leaves a gap, repeats an offset
 * or runs past the end of the line changes the colours of a run and never the
 * words.
 *
 * @param {String} code
 * @param {Array<Array<{offset: Number, type: String}>>} tokens per line, as
 * monaco's tokenize answers
 * @return {Array<Array<{text: String, className: String}>>}
 */
export const codeRows = (code, tokens) => String(code == null ? '' : code).split('\n').map((line, index) => {
  const spans = []
  const lineTokens = Array.isArray(tokens) && Array.isArray(tokens[index]) ? tokens[index] : []
  let at = 0

  const push = (text, className) => {
    if (text !== '') {
      spans.push({text, className})
    }
  }

  for (let tokenAt = 0; tokenAt < lineTokens.length; tokenAt++) {
    // a token never starts before what the line has already given away, and
    // never ends past its own last character
    const start = Math.max(at, Math.min(line.length, offsetOf(lineTokens[tokenAt], at)))
    const next = lineTokens[tokenAt + 1]
    const end = Math.min(line.length, Math.max(start, offsetOf(next, line.length)))

    if (start > at) {
      push(line.slice(at, start), '')
    }

    push(line.slice(start, end), tokenClass(lineTokens[tokenAt]?.type))
    at = end
  }

  if (at < line.length) {
    push(line.slice(at), '')
  }

  return spans
})

export default codeRows
