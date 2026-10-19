import {atom} from 'jotai'
import {atomWithImmer} from 'jotai-immer'
import {nanoid} from 'nanoid'

import {allSnippets, createSnippet, deleteSnippet, getConnection, updateSnippet} from '../utils/api'

/**
 * A snippet of this connection, as the app holds one: the caller brings what it
 * knows — Save brings the name and the code the session was holding — and the id
 * is always the store's to mint.
 */
const newSnippet = snippet => ({
  id: nanoid(),
  name: '',
  code: '',
  ...snippet,
})

/**
 * The snippets of the connection, as the main process holds them.
 *
 * Nothing invents one: a connection nothing has been written in holds no
 * snippet, and the window shows its empty state — the session, with the offer
 * to create the first snippet — until one is.
 */
const snippetDataAtom = atomWithImmer(allSnippets())

const snippetListAtom = atom(get => Object.values(get(snippetDataAtom)))

const createSnippetAtom = atom(null, (get, set, snippet) => {
  set(snippetDataAtom, data => {
    data[snippet.id] = snippet
  })

  createSnippet(get(snippetDataAtom)[snippet.id])
})

const updateSnippetAtom = atom(null, (get, set, snippet) => {
  set(snippetDataAtom, data => {
    for (const key in snippet) {
      if (key !== 'id') {
        data[snippet.id][key] = snippet[key]
      }
    }
  })

  updateSnippet(get(snippetDataAtom)[snippet.id])
})

const deleteSnippetAtom = atom(null, (get, set, id) => {
  set(snippetDataAtom, data => {
    delete data[id]
  })

  deleteSnippet(id)
})

/**
 * The snippets a connection has, as another process last wrote them.
 *
 * The app writes this file too, and it writes it through the main process, so a
 * change made here is already in the store. What this is for is the other writer:
 * an MCP server saving or deleting a snippet from a client. The whole file is
 * what that changes, so the answer replaces the store rather than being applied
 * to it — a snippet deleted out there has no message of its own, and one merged
 * in would only ever add.
 *
 * A snippet the window has open and another writer deleted is left in the store
 * as the writer left it: nothing is read back into the editor, and the list stops
 * offering it.
 */
const snippetsConnectionAtom = atom(null, (get, set, {connection, snippets} = {}) => {
  // a change for a connection the window is not on is not this window's: the
  // watcher follows the window, and this is what says so if a stale one arrives
  if (connection !== getConnection()?.id) {
    return
  }

  const next = {}

  // the store's shape is the file's: a snippet by its id
  for (const [id, snippet] of Object.entries(snippets || {})) {
    next[id] = snippet
  }

  set(snippetDataAtom, next)
})

const snippetAtoms = {}

const snippetAtomWithId = id => {
  if (!snippetAtoms[id]) {
    snippetAtoms[id] = atom(get => get(snippetDataAtom)[id])
  }

  return snippetAtoms[id]
}

export {
  snippetDataAtom,
  snippetListAtom,
  createSnippetAtom,
  updateSnippetAtom,
  deleteSnippetAtom,
  snippetAtomWithId,
  snippetsConnectionAtom,
  newSnippet,
}
