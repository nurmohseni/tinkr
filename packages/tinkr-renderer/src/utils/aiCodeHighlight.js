import * as monaco from 'monaco-editor'

import {codeRows} from './aiCode'

/**
 * The snippet an answer proposes, tokenized by the same grammar the editor
 * uses.
 *
 * The editor registers `php-snippet` when it mounts, and this is the window's
 * only editor, so the grammar is there by the time an answer arrives. A token
 * type this build has never heard of is a run with no colour, and a language
 * that is not registered reads as one plain run, which is why the call is
 * guarded: a highlight is a reading of the words and never a reason to lose
 * them.
 */

const LANGUAGE = 'php-snippet'

/** Past this, the words are worth more than the colours. */
const LIMIT = 20000

/**
 * @param {String} code
 * @return {Array<Array<{text: String, className: String}>>}
 */
export const highlightCode = code => {
  const source = String(code == null ? '' : code)

  if (source.length > LIMIT) {
    return codeRows(source, null)
  }

  try {
    return codeRows(source, monaco.editor.tokenize(source, LANGUAGE))
  } catch {
    return codeRows(source, null)
  }
}

export default highlightCode
