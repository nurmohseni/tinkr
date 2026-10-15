import PropTypes from 'prop-types'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import {clearHistoryPromptAtom, historyListAtom} from '../../stores/history'
import useNewSession from '../../hooks/useNewSession'

// how many runs the sidebar shows: a connection keeps more than this, and it is
// the list that has to stay scannable
const shownLimit = 20

/** The design's bin, drawn inline at the size of the other section icons. */
const BinIcon = () => (
  <svg
    width='13'
    height='13'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinecap='round'
  >
    <path d='M2.8 4.4h10.4'/>
    <path d='M6.4 4.4V3.2h3.2v1.2'/>
    <path d='M4.5 4.4l.6 8.3h5.8l.6-8.3'/>
    <path d='M6.8 6.9v3.6M9.2 6.9v3.6'/>
  </svg>
)

const ClockIcon = () => (
  <svg
    width='13'
    height='13'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
  >
    <circle cx='8' cy='8' r='6.2'/>
    <path d='M8 4.4V8l2.6 1.6' strokeLinecap='round'/>
  </svg>
)

// the count in the header is today's runs, so a day is a calendar day here,
// not the last twenty-four hours
const isToday = at => new Date(at).toDateString() === new Date().toDateString()

/**
 * What a run is called where it opens: the time it ran, and the day too when
 * that was not today.
 *
 * @param {IntlShape} intl
 * @param {Number} at
 * @return {String}
 */
const runTitle = (intl, at) => (isToday(at)
  ? intl.formatTime(at)
  : `${intl.formatDate(at, {day: 'numeric', month: 'short'})} ${intl.formatTime(at)}`)

// the run result knows three outcomes, and the row says which one it was: the
// value came back, only what the run printed came back, or it threw
const outcomeMessage = outcome => {
  switch (outcome) {
    case 'returned':
      return 'editor.history_returned'
    case 'threw':
      return 'editor.history_threw'
    default:
      return 'editor.history_printed'
  }
}

const outcomeBadge = outcome => {
  switch (outcome) {
    case 'returned':
      return 'badge badge--success'
    case 'threw':
      return 'badge badge--error'
    default:
      return 'badge'
  }
}

/**
 * One run in the sidebar: the first line of the code that ran, when it ran, and
 * what came back.
 *
 * Opening it is a new tab holding that code, named for the time it ran: it
 * replaces nothing, so a snippet the window has open is still open afterwards.
 */
const HistoryItem = ({entry, onOpen}) => {
  const intl = useIntl()
  // a row is one line tall, so it carries the first line of the code that ran
  const line = entry.code.trim().split('\n')[0]
  const time = isToday(entry.at)
    ? intl.formatTime(entry.at)
    : intl.formatDate(entry.at, {day: 'numeric', month: 'short'})

  return (
    <button
      className='tree-nav__row tree-nav__row--child'
      type='button'
      title={`${intl.formatMessage({id: 'editor.history_load'})} · ${intl.formatDate(entry.at)} ${intl.formatTime(entry.at)}`}
      onClick={() => onOpen(entry)}
    >
      <span className='truncate mono' style={{fontSize: 'var(--fs-sm)'}}>
        {line || <FormattedMessage id='editor.history_empty_code'/>}
      </span>

      <span className='sidebar__meta'>{time}</span>

      <span className={outcomeBadge(entry.outcome)}>
        <FormattedMessage id={outcomeMessage(entry.outcome)}/>
      </span>
    </button>
  )
}

HistoryItem.propTypes = {
  entry: PropTypes.shape({
    id: PropTypes.string.isRequired,
    code: PropTypes.string.isRequired,
    at: PropTypes.number.isRequired,
    outcome: PropTypes.string.isRequired,
  }).isRequired,
  onOpen: PropTypes.func.isRequired,
}

/**
 * The runs of the connection, under the design's History row — which is a real
 * header here, carrying how many runs were today, and folding the list away
 * when it is clicked. A connection that has not run anything yet says so in one
 * faint line rather than showing an empty list.
 */
const HistoryList = () => {
  const intl = useIntl()
  const entries = useAtomValue(historyListAtom)
  const startSession = useNewSession()
  const askToClear = useSetAtom(clearHistoryPromptAtom)
  const today = entries.filter(entry => isToday(entry.at)).length
  const shown = entries.slice(0, shownLimit)

  return (
    <nav
      className='sidebar__section'
      aria-label={intl.formatMessage({id: 'editor.history'})}
    >
      <details open>
        <summary className='tree-nav__row' style={{marginTop: 'var(--s2)'}}>
          <span className='tree-nav__caret'/>
          <ClockIcon/>
          <span><FormattedMessage id='editor.history'/></span>

          {entries.length > 0 && (
            <span className='sidebar__meta'>
              <FormattedMessage id='editor.history_today' values={{count: today}}/>
            </span>
          )}

          {entries.length > 0 && (
            <button
              className='btn btn--ghost btn--icon btn--sm'
              type='button'
              title={intl.formatMessage({id: 'editor.history_clear'})}
              aria-label={intl.formatMessage({id: 'editor.history_clear'})}
              onClick={event => {
                // the row it sits on folds the list when it is clicked
                event.preventDefault()
                event.stopPropagation()
                askToClear(true)
              }}
            >
              <BinIcon/>
            </button>
          )}
        </summary>

        {entries.length === 0 && (
          <div className='tree-nav__row tree-nav__row--child'>
            <span className='faint truncate'>
              <FormattedMessage id='editor.history_empty'/>
            </span>
          </div>
        )}

        {shown.map(entry => (
          <HistoryItem
            key={entry.id}
            entry={entry}
            onOpen={() => startSession({name: runTitle(intl, entry.at), code: entry.code})}
          />
        ))}
      </details>
    </nav>
  )
}

export default HistoryList
