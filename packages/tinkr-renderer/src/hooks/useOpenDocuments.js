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
import {closeTabAtom, decodeLogName, logTabId, logTabName, openTabAtom, openTabsAtom} from '../stores/tabs'

/**
 * The documents this window has open, and the way between them.
 *
 * The route names the document on screen — a snippet's editor or its form, a log
 * file read where it lives, or a session at / — and the tab bar draws every
 * document the window has open, so a tab is only ever the claim that one of them
 * is open here. Opening, activating and closing all go through this one place,
 * because what a closing tab leaves behind is the same question whether that tab
 * was a snippet's, a log's or a session's: the next one along, or, when nothing is
 * left, a fresh session for the window to start from.
 *
 * A log file is a document like the others and not a reading of one: it has no
 * code to hold, no caret and nothing to save, so its tab is opened, closed and
 * activated here and answers nothing else.
 *
 * @return {{documents: Array, activeId: String|null, activate: Function, close: Function}}
 */
const useOpenDocuments = () => {
  const [, setLocation] = useHashLocation()
  const [, params] = useRoute('/snippets/:id/:mode')
  const [, logParams] = useRoute('/logs/:name')
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
  // wouter hands a route parameter over as it was written, so what a log tab is
  // named is decoded here: the route was written with the name encoded
  const routeLog = logParams?.name ? decodeLogName(logParams.name) : null
  const activeId = routeLog ? logTabId(routeLog) : (routeId || activeSession?.id || null)

  // the document the window is on is open whether or not this has recorded it
  // yet, so a tab never lags a navigation, and the window always has one
  const ids = activeId && !openTabs.includes(activeId) ? openTabs.concat(activeId) : openTabs

  const documents = ids.map(id => {
    const log = logTabName(id)
    const snippet = log ? null : snippets.find(item => item.id === id)
    const session = log || snippet ? null : sessions.find(item => item.id === id)

    return {
      id,
      log,
      isLog: Boolean(log),
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
   * a snippet at its own, a log file at the route that reads it.
   */
  const activate = useCallback(id => {
    if (!id) {
      ensureSession()
      setLocation('/')
      return
    }

    const log = logTabName(id)

    if (log) {
      setLocation(`/logs/${encodeURIComponent(log)}`)
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

  return {documents, activeId, activate, close}
}

export default useOpenDocuments
