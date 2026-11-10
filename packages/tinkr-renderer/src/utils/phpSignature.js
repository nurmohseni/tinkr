/**
 * The parameter hint of the php call the caret is in.
 *
 * Monaco asks for it when a `(` or a `,` is typed, and shows the signature of the
 * call whose bracket is still open — which argument the caret is in decides what
 * is highlighted. The snippet is the only thing read here: which call it is, and
 * what that call takes, is the main process's business, answered from what it has
 * read of the project (see completion.js there). A call it does not know has no
 * signature to draw, and nothing is drawn.
 *
 * The active argument is counted here rather than there because it is a property
 * of the text the editor holds, not of the project: a comma inside a string, an
 * array or a nested call is not an argument boundary, and the scan that says so is
 * the same one a snippet's own words are read with.
 */

// one past a string's closing quote, escapes included; an open string ends with
// the snippet
const endOfQuoted = (source, start, limit) => {
  const quote = source[start]
  let i = start + 1

  while (i < limit) {
    if (source[i] === '\\') {
      i += 2
      continue
    }

    if (source[i] === quote) {
      return i + 1
    }

    i++
  }

  return limit
}

// one past a comment that starts at `start`, or -1 when it does not close before
// the limit
const endOfComment = (source, start, limit) => {
  if (source[start + 1] === '/') {
    const end = source.indexOf('\n', start)

    return end === -1 || end > limit ? limit : end + 1
  }

  if (source[start + 1] === '*') {
    const end = source.indexOf('*/', start + 2)

    return end === -1 || end + 2 > limit ? limit : end + 2
  }

  return -1
}

/**
 * The bracket the caret's argument belongs to, and which argument that is.
 *
 * The scan goes forward from the start of the snippet and keeps a stack of open
 * brackets, so every comma counts for the bracket it is written in: `cache()->remember('a,b', 60, fn () => [1, 2])` has three arguments, and none of the
 * commas inside the string, the array or the closure closes one of them.
 *
 * @param {String} code
 * @param {Number} offset the caret
 * @return {{open: Number, activeParameter: Number}|null}
 */
export const callFrameAt = (code, offset) => {
  if (typeof code !== 'string') {
    return null
  }

  const at = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, code.length))
  const stack = []
  let i = 0

  while (i < at) {
    const char = code[i]

    if (char === "'" || char === '"') {
      i = endOfQuoted(code, i, at)
      continue
    }

    if (char === '/' || char === '#') {
      const end = endOfComment(code, i, at)

      if (end !== -1) {
        i = end
        continue
      }

      i++
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      stack.push({open: i, bracket: char, commas: 0})
    } else if (char === ')' || char === ']' || char === '}') {
      stack.pop()
    } else if (char === ',' && stack.length) {
      stack[stack.length - 1].commas++
    }

    i++
  }

  const frame = stack[stack.length - 1]

  return frame && frame.bracket === '(' ? {open: frame.open, activeParameter: frame.commas} : null
}

/**
 * @param {Object} answer what the main process answered with
 * @param {Number} activeParameter
 * @return {Object|null} monaco's signature help, or null when there is none
 */
export const toSignatureHelp = (answer, activeParameter) => {
  if (!answer || !answer.label) {
    return null
  }

  const parameters = Array.isArray(answer.parameters) ? answer.parameters : []

  return {
    signatures: [{
      label: answer.label,
      parameters: parameters.map(parameter => ({label: parameter.label})),
    }],
    activeSignature: 0,
    // a signature that takes nothing highlights no argument, and monaco reads a
    // negative index as none
    activeParameter: parameters.length === 0
      ? -1
      : Math.min(Math.max(activeParameter, 0), parameters.length - 1),
  }
}

/**
 * @param {monaco} monaco
 * @param {Function} ask the connection's signature call
 * @return {Object} a monaco signature help provider
 */
export const createSignatureProvider = (monaco, ask) => ({
  signatureHelpTriggerCharacters: ['(', ','],

  provideSignatureHelp: async (model, position, token) => {
    const code = model.getValue()
    const offset = model.getOffsetAt(position)
    const frame = callFrameAt(code, offset)

    if (!frame) {
      return null
    }

    let answer

    try {
      answer = await ask({code, offset})
    } catch (e) {
      // a hint is never worth an error where someone is typing
      return null
    }

    if (token.isCancellationRequested) {
      return null
    }

    return toSignatureHelp(answer, frame.activeParameter)
  },
})

/**
 * @param {monaco} monaco
 * @param {Function} ask
 * @return {monaco.IDisposable}
 */
export const registerPHPSignatureProvider = (monaco, ask) =>
  monaco.languages.registerSignatureHelpProvider('php-snippet', createSignatureProvider(monaco, ask))
