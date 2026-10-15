import {useRoute} from 'wouter'
import {useAtomValue} from 'jotai'

import {activeSessionAtom} from '../stores/sessions'

/**
 * The document the window is showing: the snippet the route names, or the
 * session the window is on at the root route.
 *
 * The editor and the ai panel both work on it, and neither of them owns it, so
 * the way to it is here rather than in either of them.
 *
 * @return {String|undefined}
 */
const useDocumentId = () => {
  const [, params] = useRoute('/snippets/:id/:mode')
  const session = useAtomValue(activeSessionAtom)

  return params?.id || session?.id
}

export default useDocumentId
