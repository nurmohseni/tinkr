import {useCallback, useEffect} from 'react'
import {useAtomValue, useSetAtom} from 'jotai'
import {useRoute} from 'wouter'
import useHashLocation from '../utils/useHashLocation'

import {snippetListAtom} from '../stores/snippets'
import {
  activeSessionAtom,
  activeSessionIdAtom,
  ensureSessionAtom,
  isSessionId,
  removeSessionAtom,
  sessionsAtom,
} from '../stores/sessions'
import {closeTabAtom, openTabAtom, openTabsAtom} from '../stores/tabs'

/**
 * The documents this window has open, and the way between them.
 *
 * The route names the document on screen — a snippet's editor or its form, or a
 * session at / — and the tab bar draws every document the window has open, so a
 * tab is only ever the claim that one of them is open here. Opening, activating
 * and closing all go through this one place, because what a closing tab leaves
 * behind is the same question whether that tab was a snippet's or a session's:
 * the next one along, or, when nothing is left, a fresh session for the window to
 * start from. The same close happens when the connection's file loses a snippet
 * another writer deleted, which is what keeps a tab from naming a document that
 * is not there any more.
 *
 * A log is not a document of this window: it is read in a window of its own.
 *
 * @return {{documents: Array, activeId: String|null, activate: Function, close: Function}}
 */
const useOpenDocuments = () => {
  const [, setLocation] = useHashLocation()
  const [, params] = useRoute('/snippets/:id/:mode')
  const snippets = useAtomValue(snippetListAtom)
  const sessions = useAtomValue(sessionsAtom)
  const openTabs = useAtomValue(openTabsAtom)
  const activeSession = useAtomValue(activeSessionAtom)
  const openTab = useSetAtom(openTabAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const removeSession = useSetAtom(removeSessionAtom)
  const ensureSession = useSetAtom(ensureSessionAtom)
  const setActiveSession = useSetAtom(activeSessionIdAtom)

  const routeId = params?.id || null
  const activeId = routeId || activeSession?.id || null

  // the document the window is on is open whether or not this has recorded it
  // yet, so a tab never lags a navigation, and the window always has one
  const ids = activeId && !openTabs.includes(activeId) ? openTabs.concat(activeId) : openTabs

  const documents = ids.map(id => {
    const snippet = snippets.find(item => item.id === id)
    const session = snippet ? null : sessions.find(item => item.id === id)

    return {
      id,
      isSession: isSessionId(id),
      snippet: snippet || null,
      session: session || null,
      document: snippet || session || null,
    }
  })

  // what the window is on is open: the one tab the window cannot do without
  useEffect(() => {
    if (activeId) {
      openTab(activeId)
    }
  }, [activeId, openTab])

  /**
   * Bring the window to a document: a session at the root route, with its tab,
   * a snippet at its own.
   */
  const activate = useCallback(id => {
    if (!id) {
      ensureSession()
      setLocation('/')
      return
    }

    if (isSessionId(id)) {
      setActiveSession(id)
      setLocation('/')
      return
    }

    setLocation(`/snippets/${id}/editor`)
  }, [ensureSession, setActiveSession, setLocation])

  const close = useCallback(id => {
    const index = ids.indexOf(id)
    const rest = ids.filter(tab => tab !== id)
    // what a closed tab leaves behind is what followed it, or what was before it
    const next = rest[index] || rest[index - 1] || null

    if (isSessionId(id)) {
      removeSession(id)
    }

    closeTab(id)

    if (id === activeId) {
      activate(next)
    }
  }, [ids, activeId, removeSession, closeTab, activate])

  // the connection's file has another writer, and a snippet it deletes can be
  // one this window has open: the tab is then a claim about a document that is
  // no longer there. It is closed the way the tab bar closes one, which is also
  // where the window goes when that tab was the one on screen. A session's tab
  // is the window's own and is dropped only when the window closes it.
  useEffect(() => {
    const gone = ids.filter(id => !isSessionId(id) && !snippets.some(snippet => snippet.id === id))

    for (const id of gone) {
      close(id)
    }
  }, [ids, snippets, close])

  return {documents, activeId, activate, close}
}

export default useOpenDocuments
