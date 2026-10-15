import {atom} from 'jotai'
import {atomWithImmer} from 'jotai-immer'
import {nanoid} from 'nanoid'

import {allSnippets, createSnippet, deleteSnippet, updateSnippet} from '../utils/api'

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
  newSnippet,
}
