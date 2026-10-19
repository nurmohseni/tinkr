import {useEffect} from 'react'
import {useSetAtom} from 'jotai'

import useDocumentId from '../../hooks/useDocumentId'
import {activeDocumentAtom} from '../../stores/editor'

/**
 * Which document's run is on screen.
 *
 * A run belongs to the tab that sent it, and the pane, the button and the status
 * bar read the run of the document being read. This is what says which document
 * that is: the route names it — a snippet, its form, or the session the window
 * is on — and the store keeps it where an atom can read it.
 *
 * It is a component rather than a line in the window because the window is what
 * the router is inside of (see WindowContainer): a hook that reads the route has
 * to be called from a component the router has reached, and the window is not
 * one of those.
 *
 * @return {null}
 */
const DocumentScope = () => {
  const id = useDocumentId()
  const setActiveDocument = useSetAtom(activeDocumentAtom)

  useEffect(() => {
    setActiveDocument(id || null)
  }, [id, setActiveDocument])

  return null
}

export default DocumentScope
