/**
 * The code an answer proposes, and what it says around it.
 *
 * The provider is asked for one fenced block holding the whole snippet, and for
 * a question a paragraph with no block at all. So the first block is what would
 * replace the editor's code, and the answer with that block taken out is what
 * the model had to say about it.
 *
 * A block that was never closed is not a proposal: an answer cut off mid block
 * would offer a broken snippet to take the editor's code over, so it is kept as
 * words with the fence it opened left out.
 */
const block = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/m

/**
 * @param {String} answer
 * @return {{text: String, code: String|null}}
 */
export const parseAnswer = answer => {
  const match = block.exec(answer)

  if (!match) {
    return {
      text: answer.replace(/^[ \t]*```[^\n]*\n?/m, '').trim(),
      code: null,
    }
  }

  // what was said around the block, read as one paragraph: the blank lines the
  // model left on either side of it are not something to show
  const text = [
    answer.slice(0, match.index).trim(),
    answer.slice(match.index + match[0].length).trim(),
  ].filter(part => part !== '').join('\n\n')

  return {
    text,
    code: match[1].replace(/\s+$/, ''),
  }
}

export default parseAnswer
