import {useStore} from 'jotai'
import {useLocation} from 'wouter'

import {addSessionAtom, newSession} from '../stores/sessions'

/**
 * Start a session — what the two + buttons do, the sidebar's and the tab bar's,
 * and what opening a run from the history does.
 *
 * A + does not create a snippet: it starts an empty session, opens its own tab
 * and takes the window to it, with nothing written to the connection. Only Save
 * names what has been typed and turns the session into a snippet. A run opened
 * from the history arrives with its code already in it and its time as its name,
 * and nothing of it is written to the connection either.
 *
 * Nothing is asked first, and nothing has to be: the sessions the window already
 * has are left exactly as they are, each still its own tab, so a + can never
 * replace code that has not been saved. Closing a session's tab is the one thing
 * that can lose it, and that is where the question is asked.
 *
 * @return {Function}
 */
const useNewSession = () => {
  const store = useStore()
  const [, setLocation] = useLocation()

  return ({name = '', code = ''} = {}) => {
    store.set(addSessionAtom, newSession({name, code}))
    setLocation('/')
  }
}

export default useNewSession
