import {useEffect} from 'react'
import {useAtomValue, useSetAtom} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'

import WindowContainer from './components/WindowContainer'
import Titlebar from './components/Titlebar'
import LogsPanel from './components/editor/LogsPanel'
import {LinesIcon} from './components/editor/icons'
import {loadLogsAtom, logsAtom, selectLogAtom} from './stores/logs'

// kilobytes as the rail says them: a whole number of them, near enough
const kb = bytes => Math.max(1, Math.round(bytes / 1024))

// the extension is noise in a list of log files, and a laravel name is long
// enough that keeping it truncates the date, which is the part that tells one
// file from another. The full name stays in the row's title.
const label = name => (name.endsWith('.log') ? name.slice(0, -4) : name)

/**
 * The files a connection keeps, as the rail of the log viewer.
 *
 * The list is the picker: a file is opened by pressing it, and what it opens is
 * the pane beside the rail. Nothing here is a tab, because this window is one
 * document — the log — and the rail is how it is chosen.
 */
const LogFileRail = () => {
  const intl = useIntl()
  const logs = useAtomValue(logsAtom)
  const load = useSetAtom(loadLogsAtom)
  const select = useSetAtom(selectLogAtom)

  useEffect(() => {
    load()
  }, [load])

  return (
    <nav
      className='sidebar rail logs-rail'
      aria-label={intl.formatMessage({id: 'editor.logs_files'})}
    >
      <div className='logs-rail__head'>
        <LinesIcon/>
        <span><FormattedMessage id='editor.logs_files'/></span>

        <span className='sidebar__meta'>{logs.files.length || ''}</span>
      </div>

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
          className={file.name === logs.file ? 'logs-rail__row logs-rail__row--active' : 'logs-rail__row'}
          type='button'
          title={file.name}
          aria-current={file.name === logs.file ? 'true' : undefined}
          onClick={() => select(file.name)}
        >
          <span className='truncate'>{label(file.name)}</span>
          <span className='sidebar__meta'>{`${kb(file.size)} KB`}</span>
        </button>
      ))}

      <div className='logs-rail__foot truncate' title={logs.dir}>{logs.dir}</div>
    </nav>
  )
}

/**
 * The log viewer, as a window of its own: the connection's files down one side
 * and the log of the chosen one filling the rest.
 *
 * It wears the same titlebar as every other window, and it is one window — the
 * main process raises the one that is open rather than making a second — so a
 * press on the logs button twice cannot leave two of them.
 */
const LogsWindow = () => (
  <WindowContainer>
    <div className='app'>
      <Titlebar settings={false} logs={false}/>

      <div className='app__body'>
        <LogFileRail/>
        <main className='main'>
          <LogsPanel/>
        </main>
      </div>
    </div>
  </WindowContainer>
)

export default LogsWindow
