import PropTypes from 'prop-types'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useIntl} from 'react-intl'
import {useAtom, useAtomValue, useSetAtom} from 'jotai'

import {
  clearLogRangeAtom,
  logsLevelsAtom,
  logsRangedAtom,
  logsSinceAtom,
  logsUntilAtom,
  setLogRangeAtom,
} from '../../stores/logs'

// every level monolog writes, which is what a file can hold and what a filter
// therefore has to be able to name
const levels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']

// the gap a panel keeps from the window's edge when it is pulled back inside it
const edge = 8

/**
 * The moment a log stamps, as a datetime field writes it.
 *
 * A log stamps `2026-08-27 11:10:52` and a datetime field wants
 * `2026-08-27T11:10`, so each way is a slice and a swap. Seconds are kept when
 * the field was given them, because a range narrower than a minute is one a
 * reader can want.
 *
 * @param {String} value what the field or the store holds
 * @return {String}
 */
const asField = value => (value ? value.replace(' ', 'T').slice(0, 19) : '')

/** The same moment the other way, in the shape the file stamps entries with. */
const asStamp = value => {
  if (!value) {
    return ''
  }

  const normal = value.replace('T', ' ')

  // a field given no seconds still names a whole minute
  return normal.length === 16 ? `${normal}:00` : normal.slice(0, 19)
}

/**
 * The filters over a log: which levels are worth reading, and the span of time
 * worth reading them in.
 *
 * A panel rather than a dialog, because filtering a log is a thing done by
 * looking: the entries are the answer to the question the filter asks, so a box
 * that covers them makes every adjustment a guess. It opens under the control
 * that raised it and stays open while the range changes underneath it.
 *
 * The range is applied by the service, not here: it is found in the file, so a
 * span that no window in memory covers still answers with its own entries.
 *
 * @param {Function} onClose
 */
const LogsFilter = ({onClose}) => {
  const intl = useIntl()
  const ref = useRef()
  const [levels_, setLevels] = useAtom(logsLevelsAtom)
  const since = useAtomValue(logsSinceAtom)
  const until = useAtomValue(logsUntilAtom)
  const setRange = useSetAtom(setLogRangeAtom)
  const clearRange = useSetAtom(clearLogRangeAtom)
  const [from, setFrom] = useState(asField(since))
  const [to, setTo] = useState(asField(until))
  const [placed, setPlaced] = useState({})

  // a panel opened near the window's edge is pulled back inside it, so the whole
  // of it is on screen whichever way the log pane sits
  useLayoutEffect(() => {
    const box = ref.current.getBoundingClientRect()

    setPlaced({
      right: Math.max(edge, Math.min(0, window.innerWidth - box.right - edge)),
    })
  }, [])

  useEffect(() => {
    const onPointerDown = event => {
      if (!ref.current.contains(event.target)) {
        onClose()
      }
    }

    const onKeyDown = event => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  // the set holds the levels that are left out, so an empty set is nothing left
  // out — every level showing — and a level is on unless it names it
  const on = level => !levels_.includes(level)

  const toggle = level => {
    setLevels(on(level)
      ? [...levels_, level]
      : levels_.filter(one => one !== level))
  }

  return (
    <div
      className='logsfilter'
      style={placed}
      ref={ref}
      role='group'
      aria-label={intl.formatMessage({id: 'editor.logs_filter'})}
    >
      <div className='logsfilter__section'>
        <span className='logsfilter__label'>
          {intl.formatMessage({id: 'editor.logs_filter_levels'})}
        </span>

        <div className='logsfilter__levels'>
          {levels.map(level => (
            <label
              className='logsfilter__level'
              key={level}
            >
              <input
                type='checkbox'
                checked={on(level)}
                onChange={() => toggle(level)}
              />
              <span>{level}</span>
            </label>
          ))}
        </div>
      </div>

      <div className='logsfilter__section'>
        <span className='logsfilter__label'>
          {intl.formatMessage({id: 'editor.logs_filter_range'})}
        </span>

        <div className='logsfilter__range'>
          <label className='logsfilter__field'>
            <span className='logsfilter__field-label'>
              {intl.formatMessage({id: 'editor.logs_filter_from'})}
            </span>
            <input
              className='input'
              type='datetime-local'
              step='1'
              value={from}
              max={to || undefined}
              onChange={event => setFrom(event.target.value)}
            />
          </label>

          <label className='logsfilter__field'>
            <span className='logsfilter__field-label'>
              {intl.formatMessage({id: 'editor.logs_filter_to'})}
            </span>
            <input
              className='input'
              type='datetime-local'
              step='1'
              value={to}
              min={from || undefined}
              onChange={event => setTo(event.target.value)}
            />
          </label>
        </div>

        <p className='logsfilter__help'>
          {intl.formatMessage({id: 'editor.logs_filter_help'})}
        </p>
      </div>

      <div className='logsfilter__foot'>
        <button
          className='btn btn--ghost btn--sm'
          type='button'
          onClick={() => {
            setFrom('')
            setTo('')
            clearRange()
            onClose()
          }}
        >
          {intl.formatMessage({id: 'editor.logs_filter_clear'})}
        </button>

        <button
          className='btn btn--primary btn--sm'
          type='button'
          onClick={() => {
            setRange({since: asStamp(from), until: asStamp(to)})
            onClose()
          }}
        >
          {intl.formatMessage({id: 'editor.logs_filter_apply'})}
        </button>
      </div>
    </div>
  )
}

LogsFilter.propTypes = {
  onClose: PropTypes.func.isRequired,
}

export {asField, asStamp, levels}
export default LogsFilter
