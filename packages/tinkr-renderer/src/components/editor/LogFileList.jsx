import {useEffect} from 'react'
import {useAtom, useAtomValue, useSetAtom} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'

import {LinesIcon} from './icons'
import {editorViewAtom} from '../../stores/editor'
import {loadLogsAtom, logsAtom, selectLogAtom} from '../../stores/logs'

/**
 * The connection's log files, as the sidebar lists them.
 *
 * A log file is read by opening it: the list is the picker, and what it opens
 * into is the editor pane's other reading — which is why a click here moves that
 * pane rather than filling a panel somewhere else. The list is read from the
 * connection's own machine, wherever it runs.
 */
const LogFileList = () => {
  const intl = useIntl()
  const logs = useAtomValue(logsAtom)
  const load = useSetAtom(loadLogsAtom)
  const select = useSetAtom(selectLogAtom)
  const [, setView] = useAtom(editorViewAtom)

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
            className={file.name === logs.file ? 'tree-nav__row tree-nav__row--active' : 'tree-nav__row'}
            type='button'
            title={file.name}
            aria-current={file.name === logs.file ? 'true' : undefined}
            onClick={() => {
              select(file.name)
              setView('logs')
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
