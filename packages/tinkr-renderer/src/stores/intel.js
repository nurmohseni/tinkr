import {atom} from 'jotai'

import {intelStatus, refreshIntel} from '../utils/api'

/**
 * What the app has read of the connection's project, as the status line shows it.
 *
 * The read is the completion's own (see services/intel in the main process): the
 * models and their columns, the classes and theirs, the facades, the config keys,
 * the routes and the rest. Nothing here asks the project anything: the status is
 * what the main process already holds, and the refresh is the read whose answer
 * the next keystroke will use.
 *
 * A failed read keeps what the previous one held: a project that could not be read
 * a moment ago still holds what it held, and a status line that emptied would be
 * saying the project lost its models.
 */
const initialIntel = {state: 'none', at: null, counts: null}

const intelAtom = atom(initialIntel)

const intelStatusAtom = atom(null, async (get, set) => {
  try {
    const answer = await intelStatus()

    set(intelAtom, answer || initialIntel)
  } catch (e) {
    set(intelAtom, state => ({...state, state: 'failed'}))
  }
})

const refreshIntelAtom = atom(null, async (get, set) => {
  const before = get(intelAtom)

  set(intelAtom, {...before, state: 'reading'})

  try {
    const answer = await refreshIntel()

    set(intelAtom, answer
      ? {...answer, counts: answer.counts || before.counts}
      : {...before, state: 'failed'})
  } catch (e) {
    set(intelAtom, {...before, state: 'failed'})
  }
})

export {
  intelAtom,
  intelStatusAtom,
  refreshIntelAtom,
}
