import {atom} from 'jotai'

import {allHistory, clearHistory} from '../utils/api'

// the runs of this connection, newest first: the main process reads them from
// its store as the window loads, and sends the list again after every run
const historyListAtom = atom(allHistory())

// whether the window is asking about clearing them: the bin is one click, and
// what it throws away cannot be brought back
const clearHistoryPromptAtom = atom(false)

/**
 * Forget this connection's runs.
 *
 * What is forgotten is the code that ran and what came back — a run in progress
 * is not touched, and neither is anything the window has open.
 */
const clearHistoryAtom = atom(null, (get, set) => {
  set(historyListAtom, clearHistory())
  set(clearHistoryPromptAtom, false)
})

export {
  historyListAtom,
  clearHistoryPromptAtom,
  clearHistoryAtom,
}
