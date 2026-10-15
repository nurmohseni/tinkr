import {atom} from 'jotai'

import {allHistory} from '../utils/api'

// the runs of this connection, newest first: the main process reads them from
// its store as the window loads, and sends the list again after every run
const historyListAtom = atom(allHistory())

export {
  historyListAtom,
}
