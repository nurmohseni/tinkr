import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useAtom, useAtomValue, useSetAtom} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'
import PropTypes from 'prop-types'

import LogsFilter from './LogsFilter'
import {
  atEnd,
  atStart,
  cancelLogPageAtom,
  followLogAtom,
  logsAtom,
  logsFollowAtom,
  logsIntervalAtom,
  logsLevelsAtom,
  logsRangedAtom,
  logsSearchAtom,
  maxPages,
  newerLogAtom,
  olderLogAtom,
  readLogAtom,
} from '../../stores/logs'

// what the intervals the viewer offers are, in the order it offers them
const intervals = [1000, 2000, 5000, 10000]

// how close to an edge the list has to be before it reads the next page
const edge = 160

// kilobytes as the footer says them: a window is a whole number of them, near enough
const kb = bytes => Math.max(1, Math.round(bytes / 1024))

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
const Entry = ({entry, id}) => (
  <details className='log' data-entry={id}>
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
  id: PropTypes.string.isRequired,
}

/**
 * The log viewer: one of the connection's log files, filtered by level and by a
 * term, and followed while it is being written to.
 *
 * Which file is read is the sidebar's to say — its list is the picker — and the
 * viewer fills the editor pane, because a log line is as wide as it is and a
 * third of a window is where it wraps. It opens on the end of the file and reads
 * a page at a time as the reader scrolls, so a file too big to hold costs a page
 * and a bounded set of pages rather than the file.
 *
 * A page is a contiguous byte window with a list of entries. The pages are kept
 * in order and the list is their concatenation, so scrolling is one list, not a
 * page that replaces another. Loading older entries at the top drops the newest
 * pages when the cap is reached, and loading newer ones at the bottom drops the
 * oldest; the side that went is read again when the reader comes back to it.
 */
const LogsPanel = () => {
  const intl = useIntl()
  const logs = useAtomValue(logsAtom)
  const read = useSetAtom(readLogAtom)
  const older = useSetAtom(olderLogAtom)
  const newer = useSetAtom(newerLogAtom)
  const cancelPage = useSetAtom(cancelLogPageAtom)
  const followNow = useSetAtom(followLogAtom)
  const levels = useAtomValue(logsLevelsAtom)
  const ranged = useAtomValue(logsRangedAtom)
  const [filtering, setFiltering] = useState(false)
  const [search, setSearch] = useAtom(logsSearchAtom)
  const [searchInput, setSearchInput] = useState(search)
  const [follow, setFollow] = useAtom(logsFollowAtom)
  const [interval, setPollInterval] = useAtom(logsIntervalAtom)
  const listRef = useRef()
  const pinned = useRef(true)
  const anchor = useRef(null)
  const request = useRef(null)
  const view = useRef(logs.revision)
  const restoredTop = useRef(null)
  const busy = logs.loading || searchInput !== search

  useEffect(() => {
    if (searchInput === search) {
      return undefined
    }

    const timer = setTimeout(() => setSearch(searchInput), 200)

    return () => clearTimeout(timer)
  }, [searchInput, search, setSearch])

  useEffect(() => {
    if (!follow || logs.file === '') {
      return undefined
    }

    const timer = setInterval(() => followNow(), interval)

    return () => clearInterval(timer)
  }, [follow, interval, logs.file, followNow])

  const remember = () => {
    const list = listRef.current
    const top = list.getBoundingClientRect().top
    anchor.current = null

    for (const row of list.querySelectorAll('[data-entry]')) {
      const box = row.getBoundingClientRect()

      if (box.bottom > top) {
        anchor.current = {key: row.dataset.entry, top: box.top - top}
        break
      }
    }
  }

  const loadPage = async (side, cancelled = false) => {
    if (busy || logs.error || (!cancelled && (logs.loadingOlder || logs.loadingNewer)) ||
      request.current || logs.pages.length === 0 ||
      (side === 'older' ? atStart(logs) : atEnd(logs))) {
      return
    }

    const pending = {side}

    request.current = pending
    remember()

    try {
      await (side === 'older' ? older() : newer())
    } finally {
      if (request.current === pending) {
        request.current = null
      }
    }
  }

  const handleScroll = () => {
    const list = listRef.current

    // A restoration is not a new request to read the opposite edge.
    if (restoredTop.current !== null && Math.abs(list.scrollTop - restoredTop.current) < 1) {
      restoredTop.current = null
      return
    }

    restoredTop.current = null
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight

    pinned.current = distance <= 1
    let cancelled = false

    if (request.current) {
      const reversed = request.current.side === 'older'
        ? distance <= edge && list.scrollTop > edge
        : list.scrollTop <= edge && distance > edge

      if (reversed) {
        cancelPage()
        request.current = null
        anchor.current = null
        cancelled = true
      } else {
        remember()
      }
    }

    if (follow && !pinned.current) {
      setFollow(false)

      if (logs.loadingNewer && !request.current) {
        cancelPage()
        cancelled = true
      }
    }

    if (list.scrollTop <= edge) {
      loadPage('older', cancelled)
    } else if (distance <= edge) {
      loadPage('newer', cancelled)
    }
  }

  useLayoutEffect(() => {
    const list = listRef.current

    if (view.current !== logs.revision) {
      view.current = logs.revision
      pinned.current = true
      anchor.current = null
      request.current = null
    }

    if (!list) {
      return
    }

    const saved = anchor.current
    const row = saved && list.querySelector(`[data-entry="${saved.key}"]`)

    if (row) {
      list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - saved.top
    } else if (pinned.current) {
      list.scrollTop = list.scrollHeight
    }

    restoredTop.current = list.scrollTop
    anchor.current = null
  }, [logs.pages, logs.revision])

  // A short result has no scrollbar to trigger the next read. Filtered pages
  // contain matching entries, not a fixed byte slice that can hide every match.
  useEffect(() => {
    const list = listRef.current

    if (list && !busy && !logs.error && !logs.loadingOlder && !logs.loadingNewer &&
      logs.pages.length > 0 && logs.pages.length < maxPages && !atStart(logs) &&
      list.scrollHeight <= list.clientHeight + edge) {
      loadPage('older')
    }
  })

  const shown = logs.entries

  const again = () => {
    pinned.current = true
    anchor.current = null
    read()
  }

  return (
    <div className='logs'>
      <div className='logs__bar'>
        <div className='logs__row'>
          <div className='logs__filter'>
            <button
              className={ranged || levels.length > 0 || search !== '' ? 'btn btn--secondary btn--sm is-on' : 'btn btn--secondary btn--sm'}
              type='button'
              aria-expanded={filtering}
              aria-label={intl.formatMessage({id: 'editor.logs_filter'})}
              onClick={() => setFiltering(open => !open)}
            >
              <FormattedMessage id='editor.logs_filter'/>
            </button>

            {filtering && <LogsFilter onClose={() => setFiltering(false)}/>}
          </div>

          <input
            className='input'
            type='search'
            value={searchInput}
            placeholder={intl.formatMessage({id: 'editor.logs_search'})}
            aria-label={intl.formatMessage({id: 'editor.logs_search'})}
            onChange={event => setSearchInput(event.target.value)}
          />

          <span className='grow'/>

          <label
            className='logs__follow'
            title={intl.formatMessage({id: 'editor.logs_follow_description'}, {seconds: interval / 1000})}
          >
            <span className='faint'><FormattedMessage id='editor.logs_follow'/></span>
            {/* the settings rows' switch, so it reads as on or off the same way
                and its knob is placed against its own track. The row is the
                switch's own row, so the knob sits beside its label and the
                interval select after it is never under it */}
            <span className='switch'>
              <input
                type='checkbox'
                checked={follow}
                aria-label={intl.formatMessage({id: 'editor.logs_follow'})}
                onChange={event => {
                  const on = event.target.checked

                  setFollow(on)

                  // Following always resumes at the newest matching entry,
                  // even when the held pages reach the tail but the viewport does not.
                  if (on) {
                    again()
                  }
                }}
              />
              <span className='switch__track'/>
            </span>
          </label>

          <select
            className='select'
            value={interval}
            disabled={!follow}
            aria-label={intl.formatMessage({id: 'editor.logs_interval'})}
            onChange={event => setPollInterval(Number(event.target.value))}
          >
            {intervals.map(seconds => (
              <option key={seconds} value={seconds}>{`${seconds / 1000}s`}</option>
            ))}
          </select>

          <button
            className='btn btn--secondary btn--sm'
            type='button'
            disabled={logs.file === ''}
            onClick={again}
          >
            {intl.formatMessage({id: 'editor.logs_read'})}
          </button>
        </div>
      </div>

      <div className='logs__body' ref={listRef} onScroll={handleScroll} aria-busy={busy || logs.loadingOlder || logs.loadingNewer}>
        {logs.error !== '' && <p className='logs__note error'>{logs.error}</p>}

        {!busy && logs.error === '' && logs.file === '' && (
          <p className='logs__note'>
            <FormattedMessage id='editor.logs_pick'/>
          </p>
        )}

        {!busy && logs.error === '' && logs.file !== '' && shown.length === 0 && (
          <p className='logs__note'>
            <FormattedMessage id='editor.logs_no_entries'/>
          </p>
        )}

        {logs.pages.map(page => {
          const entries = page.entries

          if (entries.length === 0) {
            return null
          }

          return (
            <div className='logs__page' data-page={page.from} key={page.from}>
              {entries.map((entry, index) => (
                <Entry key={`${page.from}-${index}`} id={`${page.from}-${index}`} entry={entry}/>
              ))}
            </div>
          )
        })}
      </div>

      <div className='logs__foot'>
        <span className='logs__read faint truncate'>
          {busy
            ? <FormattedMessage id='editor.logs_reading'/>
            : logs.loadingOlder
              ? <FormattedMessage id='editor.logs_loading_older'/>
              : logs.loadingNewer
                ? <FormattedMessage id='editor.logs_loading_newer'/>
                : atEnd(logs)
                  ? (
                    <FormattedMessage
                      id='editor.logs_read_of'
                      values={{read: kb(logs.read), size: kb(logs.size)}}
                    />
                    )
                  : (
                    <FormattedMessage
                      id='editor.logs_read_of_before'
                      values={{
                        read: kb(logs.read),
                        back: kb(logs.size - logs.from - logs.read),
                        size: kb(logs.size),
                      }}
                    />
                    )}
        </span>

        {logs.file !== '' && atStart(logs) && !atEnd(logs) && (
          <span className='logs__read faint'>
            <FormattedMessage id='editor.logs_start'/>
          </span>
        )}

        {logs.file !== '' && atEnd(logs) && !atStart(logs) && (
          <span className='logs__read faint'>
            <FormattedMessage id='editor.logs_end'/>
          </span>
        )}

        <span className='logs__dir faint truncate' title={logs.dir}>{logs.dir}</span>
      </div>
    </div>
  )
}

export default LogsPanel
