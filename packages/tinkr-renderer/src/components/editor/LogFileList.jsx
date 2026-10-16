import {useEffect} from 'react'
import {useAtomValue, useSetAtom} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'
import {useRoute} from 'wouter'

import {LinesIcon} from './icons'
import useHashLocation from '../../utils/useHashLocation'
import {decodeLogName, logTabId, openTabAtom} from '../../stores/tabs'
import {loadLogsAtom, logsAtom} from '../../stores/logs'

/**
 * The connection's log files, as the sidebar lists them.
 *
 * A file is opened by clicking it, and what it opens is a tab of its own — a
 * document like a snippet, read where it lives. The list is read from the
 * connection's own machine, wherever it runs.
 */
const LogFileList = () => {
  const intl = useIntl()
  const logs = useAtomValue(logsAtom)
  const load = useSetAtom(loadLogsAtom)
  const openTab = useSetAtom(openTabAtom)
  const [, setLocation] = useHashLocation()
  const [, params] = useRoute('/logs/:name')
  const showing = params?.name ? decodeLogName(params.name) : null

  // the files of the connection are read when there are none: the first time the
  // sidebar is drawn, and after a window has switched to another connection
  useEffect(() => {
    if (logs.dir === '' && !logs.loading) {
      load()
    }
  }, [logs.dir, logs.loading])

  const size = file => `${Math.max(1, Math.round(file.size / 1024))} KB`
  // the extension is noise in a list of log files, and a laravel name is long
  // enough that keeping it truncates the date — which is the part that tells one
  // file from another. The full name stays in the row's title.
  const label = file => (file.name.endsWith('.log') ? file.name.slice(0, -4) : file.name)

  return (
    <nav
      className='sidebar__section'
      aria-label={intl.formatMessage({id: 'editor.logs_files'})}
    >
      <details open>
        <summary className='tree-nav__row'>
          <span className='tree-nav__caret'/>
          <LinesIcon/>
          <span><FormattedMessage id='editor.logs_files'/></span>

          <span className='sidebar__meta'>{logs.files.length || ''}</span>
        </summary>

        {logs.files.length === 0 && (
          <p className='sidebar__note'>
            {logs.loading
              ? <FormattedMessage id='editor.logs_reading'/>
              : <FormattedMessage id='editor.logs_empty' values={{dir: logs.dir}}/>}
          </p>
        )}

        {logs.files.map(file => (
          <button
            key={file.name}
            className={file.name === showing ? 'tree-nav__row tree-nav__row--active' : 'tree-nav__row'}
            type='button'
            title={file.name}
            aria-current={file.name === showing ? 'true' : undefined}
            onClick={() => {
              openTab(logTabId(file.name))
              setLocation(`/logs/${encodeURIComponent(file.name)}`)
            }}
          >
            <span className='tree-nav__caret'/>
            <span className='truncate mono' style={{fontSize: 'var(--fs-sm)'}}>{label(file)}</span>
            <span className='sidebar__meta'>{size(file)}</span>
          </button>
        ))}
      </details>
    </nav>
  )
}

export default LogFileList
