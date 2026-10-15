import {atom} from 'jotai'

import {allHistory} from '../utils/api'
import {writeCodeAtom} from './sessions'

// the runs of this connection, newest first: the main process reads them from
// its store as the window loads, and sends the list again after every run
const historyListAtom = atom(allHistory())

// the entry the window is showing, with the document it was loaded into: a row
// stays marked only for as long as that document still holds that code
const loadedHistoryAtom = atom(null)

/**
 * Put the code of a run back into the document the window is on — the snippet it
 * has open, or the session it is on when no snippet is.
 *
 * It goes through the same write the editor makes while you type, so the store,
 * the file, and the editor all end up with that run's code, and the entry is
 * remembered as the one being looked at.
 */
const loadHistoryAtom = atom(null, (get, set, {snippetId, entry}) => {
  if (!snippetId || !entry) {
    return
  }

  set(writeCodeAtom, {id: snippetId, code: entry.code})
  set(loadedHistoryAtom, {snippetId, entryId: entry.id, code: entry.code})
})

export {
  historyListAtom,
  loadedHistoryAtom,
  loadHistoryAtom,
}
