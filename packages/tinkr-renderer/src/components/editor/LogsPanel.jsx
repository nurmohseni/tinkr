import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useAtom, useAtomValue, useSetAtom} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'
import PropTypes from 'prop-types'

import LogsFilter from './LogsFilter'
import {
  atEnd,
  atStart,
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
  passesLevel,
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
  const followNow = useSetAtom(followLogAtom)
  const levels = useAtomValue(logsLevelsAtom)
  const ranged = useAtomValue(logsRangedAtom)
  const [filtering, setFiltering] = useState(false)
  const [search, setSearch] = useAtom(logsSearchAtom)
  const [follow, setFollow] = useAtom(logsFollowAtom)
  // not named setInterval: that name is the timer below, and a setter in its
  // place turned following into a store write that never read anything
  const [interval, setPollInterval] = useAtom(logsIntervalAtom)
  const listRef = useRef()
  const pinned = useRef(true)
  const firstLoad = useRef(true)
  // what the layout should do after a page lands: 'older' keeps the entry that
  // was under the eye where it was, 'newer' holds the foot
  const intent = useRef(null)
  const priorFrom = useRef(null)
  const loading = useRef({older: false, newer: false})

  // a level or a search term is applied to the entries in hand. Paging older
  // pages under it would drop the newest page — and the matches that may be the
  // only reason the list is not empty — so the filtered view stays on what is
  // loaded. A range is the service's, and pages inside it are still read.
  const filtered = levels.length > 0 || search.trim() !== ''

  // another file opens on its end, as the first one did, whatever the reader
  // had scrolled to in the file they left
  useEffect(() => {
    pinned.current = true
    firstLoad.current = true
    intent.current = null
  }, [logs.file])

  // following: the file is being appended to, so the end is read again
  useEffect(() => {
    if (!follow || logs.file === '') {
      return undefined
    }

    const timer = setInterval(() => followNow(), interval)

    return () => clearInterval(timer)
  }, [follow, interval, logs.file, followNow])

  const loadOlder = async () => {
    if (filtered || loading.current.older || atStart(logs) || logs.pages.length === 0) {
      return
    }

    loading.current.older = true
    intent.current = 'older'
    priorFrom.current = logs.pages[0].from

    await older()

    loading.current.older = false
  }

  const loadNewer = async () => {
    if (loading.current.newer || atEnd(logs) || logs.pages.length === 0) {
      return
    }

    loading.current.newer = true
    intent.current = 'newer'

    await newer()

    loading.current.newer = false
  }

  const handleScroll = () => {
    const list = listRef.current

    if (!list) {
      return
    }

    const top = list.scrollTop <= edge
    const bottom = list.scrollHeight - list.scrollTop - list.clientHeight <= edge

    pinned.current = bottom

    // following is watching the tail; a reader who has left it is not following
    // any more, and the switch says so rather than pulling them back
    if (follow && !bottom) {
      setFollow(false)
    }

    if (top) {
      loadOlder()
    }

    if (bottom) {
      loadNewer()
    }
  }

  // a page that lands above the one under the eye must not move it: the pages
  // that were prepended are measured, and the scroll is moved by their height.
  // A page that lands below keeps the foot in view, which is where a reader
  // loading newer entries is.
  useLayoutEffect(() => {
    const list = listRef.current

    if (!list) {
      return
    }

    if (intent.current === 'older') {
      let added = 0

      for (const page of list.querySelectorAll('[data-page]')) {
        if (priorFrom.current !== null && Number(page.dataset.page) < priorFrom.current) {
          added += page.offsetHeight
        }
      }

      if (added > 0) {
        list.scrollTop += added
      }
    } else if (intent.current === 'newer') {
      list.scrollTop = list.scrollHeight
    } else if (firstLoad.current || pinned.current) {
      list.scrollTop = list.scrollHeight
    }

    firstLoad.current = false
    intent.current = null
    priorFrom.current = null
  }, [logs.pages])

  // a filter that leaves a shorter list is read under the eye, not moved to the
  // foot unless the reader was at the foot
  useEffect(() => {
    const list = listRef.current

    if (list && pinned.current) {
      list.scrollTop = list.scrollHeight
    }
  }, [levels, search])

  // a page can be shorter than the pane — a file with long lines, or a filter
  // that hides most of it. Fill the pane before waiting for a scroll that cannot
  // happen, up to the same page cap the rest of the viewer uses.
  useEffect(() => {
    const list = listRef.current

    if (!list || logs.loading || logs.loadingOlder || logs.pages.length === 0) {
      return
    }

    if (!filtered && logs.pages.length < maxPages && !atStart(logs) && list.scrollHeight <= list.clientHeight + edge) {
      loadOlder()
    }
  }, [logs.pages, logs.loading, logs.loadingOlder, levels, search])

  const term = search.trim().toLowerCase()
  const visible = entry => {
    if (entry.level !== null && !passesLevel(levels, entry.level)) {
      return false
    }

    if (term === '') {
      return true
    }

    return `${entry.at} ${entry.level} ${entry.message} ${entry.details}`.toLowerCase().includes(term)
  }

  const shown = logs.entries.filter(visible)

  const again = () => {
    pinned.current = true
    intent.current = null
    read()
  }

  return (
    <div className='logs'>
      <div className='logs__bar'>
        <div className='logs__row'>
          <div className='logs__filter'>
            <button
              className={ranged ? 'btn btn--secondary btn--sm is-on' : 'btn btn--secondary btn--sm'}
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

                  // following is watching the tail; turning it on away from the
                  // tail goes there rather than waiting for a read of a file
                  // whose end is not on screen
                  if (on && !atEnd(logs)) {
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

        {logs.pages.map(page => {
          const entries = page.entries.filter(visible)

          if (entries.length === 0) {
            return null
          }

          return (
            <div className='logs__page' data-page={page.from} key={page.from}>
              {entries.map((entry, index) => (
                <Entry key={`${page.from}-${index}`} entry={entry}/>
              ))}
            </div>
          )
        })}
      </div>

      <div className='logs__foot'>
        <span className='logs__read faint truncate'>
          {logs.loadingOlder
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
