import PropTypes from 'prop-types'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'
import {useRoute} from 'wouter'

import {historyListAtom, loadHistoryAtom, loadedHistoryAtom} from '../../stores/history'
import {activeSessionAtom, documentAtomWithId} from '../../stores/sessions'

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
 * what came back. Clicking it puts that code back in the editor.
 */
const HistoryItem = ({entry, name, active, onLoad}) => {
  const intl = useIntl()
  // a row is one line tall, so it carries the first line of the code that ran
  const line = entry.code.trim().split('\n')[0]
  const time = isToday(entry.at)
    ? intl.formatTime(entry.at)
    : intl.formatDate(entry.at, {day: 'numeric', month: 'short'})

  return (
    <button
      className={active ? 'tree-nav__row tree-nav__row--child tree-nav__row--active' : 'tree-nav__row tree-nav__row--child'}
      type='button'
      title={`${intl.formatMessage({id: 'editor.history_load'}, {name})} · ${intl.formatDate(entry.at)} ${intl.formatTime(entry.at)}`}
      aria-current={active ? 'true' : undefined}
      onClick={onLoad}
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
  name: PropTypes.string.isRequired,
  active: PropTypes.bool.isRequired,
  onLoad: PropTypes.func.isRequired,
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
  const [, params] = useRoute('/snippets/:id/:mode')
  const load = useSetAtom(loadHistoryAtom)
  const loaded = useAtomValue(loadedHistoryAtom)

  // the window routes one document at a time, and that is the document a row
  // loads into — the session the window is on when no snippet is; the row stays
  // marked while that document still holds its code
  const session = useAtomValue(activeSessionAtom)
  const snippetId = params?.id || session?.id
  const document = useAtomValue(documentAtomWithId(snippetId))
  const name = document?.name || intl.formatMessage({id: 'editor.unsaved'})
  const today = entries.filter(entry => isToday(entry.at)).length
  const loadedId = loaded && loaded.snippetId === snippetId && document?.code === loaded.code
    ? loaded.entryId
    : null

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
        </summary>

        {entries.length === 0 && (
          <div className='tree-nav__row tree-nav__row--child'>
            <span className='faint truncate'>
              <FormattedMessage id='editor.history_empty'/>
            </span>
          </div>
        )}

        {entries.map(entry => (
          <HistoryItem
            key={entry.id}
            entry={entry}
            name={name}
            active={entry.id === loadedId}
            onLoad={() => load({snippetId, entry})}
          />
        ))}
      </details>
    </nav>
  )
}

export default HistoryList
