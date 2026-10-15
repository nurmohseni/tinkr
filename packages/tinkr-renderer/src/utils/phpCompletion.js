/**
 * The suggestion popup of a php snippet: the project's class names while a name
 * is being typed, and the public methods of the class a `::` has been written
 * after.
 *
 * Monaco asks on every keystroke and drops the answer it is no longer waiting
 * for, so this does no work of its own: the class index and the session's
 * reflection live in the main process, which caches both (see completion.js
 * there), and a question already being asked is answered once.
 *
 * `php-snippet` has its own inline completion provider — the AI ghost text —
 * and the two are separate providers: this one never touches that one.
 */

// what opens the popup: the second colon of a `::`, the `>` of a `->`, and a
// namespace separator while a class name is being spelled out
const triggerCharacters = [':', '>', '\\']

// how much of the code before the cursor is sent: a suggestion is read from the
// text right there, and a snippet is small, but a pasted file is not worth
// sending on every keystroke
const window = 20000

/**
 * @param {Object} item what the main process answered with
 * @param {monaco.languages.CompletionItemKind} kinds
 * @param {Number} insertAsSnippet the rule that makes monaco read a snippet
 * @return {Object} a monaco completion item
 */
export const toMonacoItem = (item, kinds, insertAsSnippet) => ({
  label: item.label,
  // what monaco filters the list on while the name is being typed: the class
  // name, or the method name without the parameters it takes
  filterText: item.filter,
  detail: item.detail,
  kind: item.type === 'method' ? kinds.Method : kinds.Class,
  insertText: item.insert,
  insertTextRules: item.snippet ? insertAsSnippet : undefined,
})

/**
 * @param {monaco} monaco
 * @param {Function} ask the connection's completion call
 * @return {Object} a monaco completion item provider
 */
export const createCompletionProvider = (monaco, ask) => ({
  triggerCharacters,

  provideCompletionItems: async (model, position, context, token) => {
    const offset = model.getOffsetAt(position)
    const from = model.getPositionAt(Math.max(0, offset - window))
    // the cursor is where the code ends, so the cursor's offset in what is sent
    // is its length
    const code = model.getValueInRange({
      startLineNumber: from.lineNumber,
      startColumn: from.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    })

    let answer

    try {
      answer = await ask({code, offset: code.length, triggerCharacter: context.triggerCharacter})
    } catch (e) {
      // a suggestion is never worth an error where someone is typing
      return {suggestions: []}
    }

    if (token.isCancellationRequested || !answer) {
      return {suggestions: []}
    }

    const kinds = monaco.languages.CompletionItemKind

    return {
      suggestions: (answer.items || []).map(item =>
        toMonacoItem(item, kinds, monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet)),
    }
  },
})

/**
 * @param {monaco} monaco
 * @param {Function} ask
 * @return {monaco.IDisposable}
 */
export const registerPHPCompletionProvider = (monaco, ask) =>
  monaco.languages.registerCompletionItemProvider('php-snippet', createCompletionProvider(monaco, ask))
