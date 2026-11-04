/**
 * An answer, read as the blocks it was written in.
 *
 * The provider is asked in markdown's terms — a paragraph, a list, a heading, a
 * fenced block — so the panel shows those blocks rather than one run-on
 * paragraph with the markers still in it. The reading is deliberately small:
 * what an answer uses to be understood, and nothing that would quietly change
 * the words. A fence that is never closed still opens a block, because a cut
 * off answer is code as far as it got; anything the reader below does not
 * recognise is a paragraph, exactly as it was written.
 *
 * The result is data, not markup: the panel draws it as elements, so an answer
 * that contains `<script>` is words like any other.
 */

const FENCE = /^ {0,3}```(.*)$/
const CLOSING_FENCE = /^ {0,3}```[ \t]*$/
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/
const BULLET = /^ {0,3}[-*+][ \t]+(.*)$/
const ORDERED = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/
const INDENTED = /^[ \t]+\S/

/**
 * The words of one line, with the code it names and the words it weighs.
 *
 * Only the two marks an answer leans on are read: a backticked span is code,
 * and a doubled asterisk is weight. Single asterisks and underscores are left
 * as they were written, because `$a * $b` is arithmetic far more often than it
 * is emphasis.
 *
 * @param {String} text
 * @return {Array<{type: String, text: String}>}
 */
export const parseInline = text => {
  const source = String(text == null ? '' : text)
  // a fresh pattern each time: a shared one would carry its last index over
  // from the answer before this one
  const inline = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g
  const spans = []
  let at = 0
  let match = inline.exec(source)

  while (match !== null) {
    if (match.index > at) {
      spans.push({type: 'text', text: source.slice(at, match.index)})
    }

    if (match[1] !== undefined) {
      spans.push({type: 'code', text: match[1]})
    } else {
      spans.push({type: 'strong', text: match[2]})
    }

    at = match.index + match[0].length
    match = inline.exec(source)
  }

  if (at < source.length) {
    spans.push({type: 'text', text: source.slice(at)})
  }

  return spans
}

/**
 * @param {String} text
 * @return {Array<Object>} paragraph, heading, list and code blocks in the order
 * they were written
 */
export const parseProse = text => {
  const blocks = []
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
  let paragraph = []
  let list = null

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({type: 'paragraph', text: paragraph.join('\n')})
      paragraph = []
    }
  }

  const flushList = () => {
    if (list !== null) {
      blocks.push(list)
      list = null
    }
  }

  const flush = () => {
    flushParagraph()
    flushList()
  }

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    const fence = FENCE.exec(line)

    if (fence) {
      flush()

      const language = fence[1].trim().split(/\s+/)[0] || ''
      const code = []

      // the block runs to its closing fence, or to the end of an answer that
      // was cut off with the block still open
      for (at = at + 1; at < lines.length && !CLOSING_FENCE.test(lines[at]); at++) {
        code.push(lines[at])
      }

      blocks.push({type: 'code', language, code: code.join('\n')})

      continue
    }

    if (line.trim() === '') {
      flush()

      continue
    }

    const heading = HEADING.exec(line)

    if (heading) {
      flush()

      blocks.push({
        type: 'heading',
        level: heading[1].length,
        // a heading may close with its own hashes, which are the marker and not
        // part of what it says
        text: heading[2].replace(/[ \t]+#+[ \t]*$/, ''),
      })

      continue
    }

    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)

    if (bullet || ordered) {
      flushParagraph()

      // a list of one kind after a list of the other is its own list: the two
      // markers number their items differently
      if (list !== null && list.ordered !== Boolean(ordered)) {
        flushList()
      }

      if (list === null) {
        list = {type: 'list', ordered: Boolean(ordered), items: []}
      }

      list.items.push(ordered ? ordered[2] : bullet[1])

      continue
    }

    // an indented line under an item is that item, still: a bullet of a long
    // sentence is one sentence
    if (list !== null && INDENTED.test(line)) {
      list.items[list.items.length - 1] = `${list.items[list.items.length - 1]} ${line.trim()}`

      continue
    }

    flushList()
    paragraph.push(line)
  }

  flush()

  return blocks
}

export default parseProse
