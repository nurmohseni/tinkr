import {useEffect} from 'react'
import {useSetAtom} from 'jotai'
import {useRoute} from 'wouter'

import LogsPanel from './LogsPanel'
import {decodeLogName} from '../../stores/tabs'
import {selectLogAtom} from '../../stores/logs'

/**
 * One of the connection's log files, at the route that names it.
 *
 * The tab bar draws the file as a document, and this is what that document is:
 * the route says which file, and the panel shows it. Nothing else about the
 * window changes — the session, the run and the terminal are all still there
 * beside it — so a log is read without leaving the code behind.
 */
const LogsView = () => {
  const [, params] = useRoute('/logs/:name')
  const select = useSetAtom(selectLogAtom)
  const name = params?.name ? decodeLogName(params.name) : ''

  // the file the route names may not be the one the panel is holding: this is
  // what makes a tab's own content its own
  useEffect(() => {
    if (name !== '') {
      select(name)
    }
  }, [name, select])

  return <LogsPanel/>
}

export default LogsView
