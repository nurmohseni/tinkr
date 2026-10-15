import {atom} from 'jotai'

/**
 * The snippet menu, and the prompts the window's controls raise.
 *
 * All of them hold what the window is showing rather than what the connection
 * keeps, so they live in the window and are read by the one component that
 * draws them: the menu carries the snippet it was opened on and where the
 * pointer was, a rename prompt carries the snippet to rename, a delete prompt
 * carries the snippet to drop, the save prompt carries the session it is about
 * to name, and the close prompt carries the session a tab is asking about.
 */
const snippetMenuAtom = atom(null)
const renameSnippetAtom = atom(null)
const deleteSnippetPromptAtom = atom(null)
const saveSnippetPromptAtom = atom(null)
const closeSessionPromptAtom = atom(null)

export {
  snippetMenuAtom,
  renameSnippetAtom,
  deleteSnippetPromptAtom,
  saveSnippetPromptAtom,
  closeSessionPromptAtom,
}
