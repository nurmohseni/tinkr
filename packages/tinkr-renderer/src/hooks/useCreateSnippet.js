import {useSetAtom} from 'jotai'
import {useLocation} from 'wouter'

import {createSnippetAtom, newSnippet} from '../stores/snippets'

/**
 * Write a snippet into the connection and open it — what Save does once it has
 * the name, and the only thing in the app that creates a snippet.
 *
 * The snippet is the caller's: Save brings the session's name, code and caret,
 * so what has been typed becomes the snippet it is named.
 *
 * @return {Function}
 */
const useCreateSnippet = () => {
  const createSnippet = useSetAtom(createSnippetAtom)
  const [, setLocation] = useLocation()

  return snippet => {
    const created = newSnippet(snippet)

    createSnippet(created)

    setLocation(`/snippets/${created.id}/editor`)

    return created
  }
}

export default useCreateSnippet
