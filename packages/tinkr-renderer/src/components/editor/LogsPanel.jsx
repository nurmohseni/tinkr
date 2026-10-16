import {useEffect, useRef} from 'react'
import {useAtom, useAtomValue, useSetAtom} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'
import PropTypes from 'prop-types'

import {
  logsAtom,
  logsFollowAtom,
  logsIntervalAtom,
  logsLevelAtom,
  logsSearchAtom,
  readLogAtom,
} from '../../stores/logs'

// what the intervals the viewer offers are, in the order it offers them
const intervals = [1000, 2000, 5000, 10000]

// how far from the foot a list counts as being at the foot: a tail keeps its end
// in view while new entries arrive, until someone scrolls away from it
const atFoot = 24

/**
 * The badge an entry's level wears, in the design's own badges: what went wrong
 * is an error, what may go wrong is a warning, and the rest is a log entry.
 *
 * @param {String|null} level
 * @return {String}
 */
const badgeOf = level => {
  if (level === 'error' || level === 'critical' || level === 'alert' || level === 'emergency') {
    return 'badge badge--error'
  }

  if (level === 'warning' || level === 'notice') {
    return 'badge badge--warning'
  }

  return 'badge'
}

/**
 * What one entry is, in the design's log row: when it was written, what it was
 * written as, and what it said. The context and the stack trace under it are
 * opened rather than summarised, because that is where a stack trace is read.
 */
const Entry = ({entry}) => (
  <details className='log'>
    <summary className='log__row'>
      <span className='log__at faint'>{entry.at || '—'}</span>
      <span className={badgeOf(entry.level)}>{entry.level || 'text'}</span>
      <span className='log__message truncate'>{entry.message}</span>
    </summary>

    {entry.details !== '' && (
      <pre className='log__details'>{entry.details}</pre>
    )}
  </details>
)

Entry.propTypes = {
  entry: PropTypes.object.isRequired,
}

/**
 * The log viewer: one of the connection's log files, filtered by level and by a
 * term, and followed while it is being written to.
 *
 * Which file is read is the sidebar's to say — its list is the picker — and the
 * viewer fills the editor pane, because a log line is as wide as it is and a
 * third of a window is where it wraps. It reads the end of the file, which is
 * where the newest entries are, and it reads it from the connection's own
 * machine, wherever that is.
 */
const LogsPanel = () => {
  const intl = useIntl()
  const logs = useAtomValue(logsAtom)
  const read = useSetAtom(readLogAtom)
  const [level, setLevel] = useAtom(logsLevelAtom)
  const [search, setSearch] = useAtom(logsSearchAtom)
  const [follow, setFollow] = useAtom(logsFollowAtom)
  const [interval, setInterval] = useAtom(logsIntervalAtom)
  const listRef = useRef()
  const pinned = useRef(true)

  // following: the file is being appended to, so the same read is made again
  useEffect(() => {
    if (!follow || logs.file === '') {
      return undefined
    }

    const timer = setInterval(() => read(), interval)

    return () => clearInterval(timer)
  }, [follow, interval, logs.file])

  // a tail keeps its foot in view, unless it has been scrolled away from
  useEffect(() => {
    const list = listRef.current

    if (list && pinned.current) {
      list.scrollTop = list.scrollHeight
    }
  }, [logs.entries, level, search])

  const handleScroll = () => {
    const list = listRef.current

    if (list) {
      pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < atFoot
    }
  }

  const term = search.trim().toLowerCase()
  const shown = logs.entries.filter(entry => {
    if (level !== 'all' && entry.level !== level) {
      return false
    }

    if (term === '') {
      return true
    }

    return `${entry.at} ${entry.level} ${entry.message} ${entry.details}`.toLowerCase().includes(term)
  })

  return (
    <div className='logs'>
      <div className='logs__bar'>
        <div className='logs__row'>
          <select
            className='select'
            value={level}
            aria-label={intl.formatMessage({id: 'editor.logs_level'})}
            onChange={event => setLevel(event.target.value)}
          >
            <option value='all'>{intl.formatMessage({id: 'editor.logs_level_all'})}</option>
            {['error', 'warning', 'info', 'debug'].map(one => (
              <option key={one} value={one}>{one}</option>
            ))}
          </select>

          <input
            className='input'
            type='search'
            value={search}
            placeholder={intl.formatMessage({id: 'editor.logs_search'})}
            aria-label={intl.formatMessage({id: 'editor.logs_search'})}
            onChange={event => setSearch(event.target.value)}
          />

          <span className='grow'/>

          <label
            className='logs__follow'
            title={intl.formatMessage({id: 'editor.logs_follow_description'}, {seconds: interval / 1000})}
          >
            <span className='faint'><FormattedMessage id='editor.logs_follow'/></span>
            <input
              type='checkbox'
              checked={follow}
              aria-label={intl.formatMessage({id: 'editor.logs_follow'})}
              onChange={event => setFollow(event.target.checked)}
            />
            <span className='switch__track'/>
          </label>

          <select
            className='select'
            value={interval}
            disabled={!follow}
            aria-label={intl.formatMessage({id: 'editor.logs_interval'})}
            onChange={event => setInterval(Number(event.target.value))}
          >
            {intervals.map(seconds => (
              <option key={seconds} value={seconds}>{`${seconds / 1000}s`}</option>
            ))}
          </select>

          <button
            className='btn btn--secondary btn--sm'
            type='button'
            disabled={logs.file === ''}
            onClick={() => {
              pinned.current = true
              read()
            }}
          >
            {intl.formatMessage({id: 'editor.logs_read'})}
          </button>
        </div>
      </div>

      <div className='logs__body' ref={listRef} onScroll={handleScroll}>
        {logs.error !== '' && <p className='logs__note error'>{logs.error}</p>}

        {logs.error === '' && logs.file === '' && (
          <p className='logs__note'>
            <FormattedMessage id='editor.logs_pick'/>
          </p>
        )}

        {logs.file !== '' && shown.length === 0 && (
          <p className='logs__note'>
            <FormattedMessage id='editor.logs_no_entries'/>
          </p>
        )}

        {shown.map((entry, index) => (
          <Entry key={`${entry.at}-${index}`} entry={entry}/>
        ))}
      </div>

      <div className='logs__foot'>
        <span className='logs__read faint truncate'>
          <FormattedMessage
            id='editor.logs_read_of'
            values={{read: Math.max(1, Math.round(logs.read / 1024)), size: Math.max(1, Math.round(logs.size / 1024))}}
          />
        </span>
        <span className='logs__dir faint truncate' title={logs.dir}>{logs.dir}</span>
      </div>
    </div>
  )
}

export default LogsPanel
