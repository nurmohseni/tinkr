import {useCallback, useEffect, useId, useRef, useState} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'
import PropTypes from 'prop-types'

import Outcome from '../Outcome'
import PointerMenu from '../PointerMenu'
import MarkdownAction from './MarkdownAction'
import ResultChanges from './ResultChanges'
import ResultGraph from './ResultGraph'
import ResultHtml from './ResultHtml'
import ResultTable from './ResultTable'
import ResultValue from './ResultValue'
import {copy, copyText} from '../../utils/clipboard'
import {guardReport, sandboxReport} from '../../utils/guardReport'
import {endingSentence, memoryLabel, statsLine} from '../../utils/runFacts'
import {
  entriesOf,
  isComposite,
  isList,
  plainValue,
  READINGS,
  readingOf,
  readingsOf,
  tableOf,
  toCsv,
} from '../../utils/resultReading'

/**
 * The result of the last run, as the design's value tree.
 *
 * The value comes from the session as json, with what the envelope says about it
 * under reserved `__tinkr` keys: the class an object was, the case an enum is,
 * the signature a closure has, the markup a view rendered. The tree says that on
 * the value's own row, and a copy of the value leaves it out, because a reader
 * pasting it wants what the run answered and not the notes about it. An
 * exception is described in full — its class, the line of the throw, and the
 * frames it came through.
 *
 * A value is read in one of several ways, and the run's own strip carries the
 * one that is on: the tree, the table of a list of records, the graph of
 * anything with something under it, the frame for a string that is markup, and
 * the text the value is drawn from. The readings a run does not have are not
 * offered, and a value a chosen reading does not have is read as its tree,
 * which is why a reading is never a blank pane.
 *
 * A run that printed says so in a block of its own above the value it returned,
 * because a print and a value are not the same fact: one answer does not stand
 * for the other.
 */

// the landing is drawn once per run, and React draws an element again only when
// its key says it is another one: an outcome is keyed by what the run answered,
// so a run landing where the last one stood replays the landing rather than
// keeping the glyph that is already there. A value is named by its type and its
// size, which keeps the key cheap; the tree under it is the reading that counts.
const answerKey = (kind, value) => (value !== null && typeof value === 'object'
  ? `${kind}:${isList(value) ? 'array' : 'object'}:${entriesOf(value).length}`
  : `${kind}:${String(value)}`)

const failureKey = error => `threw:${error.class}:${error.message}`

/**
 * What the value is, in the language the app is in: `3 items`, `2 keys`, or the
 * type of a leaf. It names the noun and nothing else, because the outcome
 * beside it already says what happened to it — `= returned 3 items` twice over
 * was one word too many.
 *
 * @param {IntlShape} intl
 * @param {any} value
 * @return {String|null}
 */
const describe = (intl, value) => {
  if (isComposite(value)) {
    const entries = entriesOf(value)

    // a value whose content is not a set of fields — a rendered view, a closure,
    // an enum case — is named by its own row, and a count is no fact about it
    if (entries.length === 0) {
      return null
    }

    return intl.formatMessage({id: isList(value) ? 'result.items' : 'result.keys'}, {count: entries.length})
  }

  const id = {
    number: 'result.returned_number',
    string: 'result.returned_string',
    boolean: 'result.returned_boolean',
  }[typeof value]

  return id ? intl.formatMessage({id}) : null
}

// the copy of a value: what the run answered with, without what the envelope
// says about it, because a reader pasting it wants the value and not the notes
const json = value => JSON.stringify(plainValue(value), null, 2)

/** The reading the switch shows as on: a view this run does not have is its tree. */
const onReading = (views, view) => (views.includes(view) ? view : 'organized')

/**
 * The body of one reading: what that reading shows of the value, and nothing
 * else. Everything a reading needs to say about itself is in the strip above
 * it, so this is one surface whichever reading is on.
 */
const Reading = ({value, view}) => {
  switch (view) {
    case 'raw':
      return <pre className='printed'>{json(value)}</pre>
    case 'table':
      return <ResultTable value={value}/>
    case 'graph':
      return <ResultGraph value={value}/>
    case 'html':
      return <ResultHtml value={value}/>
    default:
      return (
        <div className='tree'>
          <ResultValue value={value} depth={0}/>
        </div>
      )
  }
}

Reading.propTypes = {
  value: PropTypes.any,
  view: PropTypes.oneOf(READINGS).isRequired,
}

/**
 * What a reading does with the whole of itself, in the strip's own buttons: a
 * table is copied and saved as a csv, and every other reading copies the json
 * the tree, the graph and the raw text are drawn from.
 */
const ReadingActions = ({value, view, children = null}) => {
  const intl = useIntl()
  const [menu, setMenu] = useState(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  if (view === 'table') {
    const {columns, rows} = tableOf(value)
    const csv = toCsv(columns, rows)

    // one button and a menu rather than two buttons: the head is one line, and
    // at the window's default width two labels pushed past the pane's edge
    return (
      <span className='result-summary__actions'>
        <button
          className='btn btn--ghost btn--sm'
          type='button'
          aria-haspopup='menu'
          aria-expanded={menu !== null}
          onClick={event => {
            const box = event.currentTarget.getBoundingClientRect()

            setMenu({left: box.left, top: box.bottom + 2})
          }}
        >
          <FormattedMessage id='result.csv'/>
        </button>

        {menu && (
          <PointerMenu at={menu} label={intl.formatMessage({id: 'result.csv'})} onClose={closeMenu}>
            <button
              className='autocomplete__item'
              type='button'
              role='menuitem'
              onClick={() => {
                closeMenu()
                copyText(csv)
              }}
            >
              <FormattedMessage id='result.copy_csv'/>
            </button>

            <button
              className='autocomplete__item'
              type='button'
              role='menuitem'
              onClick={() => {
                closeMenu()
                window.api.saveFile('result.csv', csv)
              }}
            >
              <FormattedMessage id='result.save_csv'/>
            </button>
          </PointerMenu>
        )}

        {children}
      </span>
    )
  }

  return (
    <span className='result-summary__actions'>
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        title={intl.formatMessage({id: 'result.copy_json'})}
        onClick={() => copy(plainValue(value))}
      >
        {intl.formatMessage({id: 'result.copy_short'})}
      </button>

      {children}
    </span>
  )
}

ReadingActions.propTypes = {
  value: PropTypes.any,
  view: PropTypes.oneOf(READINGS).isRequired,
  children: PropTypes.node,
}

/**
 * How long the run took, as the small note the summary ends with.
 *
 * The time is what the person waited through, boot of the session included, and
 * it is measured by the main process — the side that knows when the code was
 * sent and when the answer came back — rather than guessed at here. It is what
 * the head falls back to when the run answered no measurement of its own (see
 * Stats), and it is the wait the tooltip of that figure names.
 */
const Duration = ({duration}) => {
  const intl = useIntl()

  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    return null
  }

  // a second is the unit, and a run that took less than a tenth of one says so
  // rather than showing `0.0s`
  const seconds = duration < 100 ? '<0.1' : (duration / 1000).toFixed(duration < 10000 ? 1 : 0)

  return (
    <span
      className='result-summary__duration mono'
      title={intl.formatMessage({id: 'result.duration_title'}, {seconds})}
    >
      {intl.formatMessage({id: 'result.duration'}, {seconds})}
    </span>
  )
}

Duration.propTypes = {
  duration: PropTypes.number,
}

/**
 * What the run spent, in the language of the machine rather than of the wait:
 * the php time of its statements and the memory they peaked at, measured inside
 * php (see runResult's STATS_ARM) and not guessed at from here.
 *
 * The wall clock is still the number the person waited through — the boot of the
 * session included — so it is what the title says, and a run whose envelope has
 * no measurement (an older session, a run that never got there) still shows it
 * in place of this.
 */
const Stats = ({stats, duration = null}) => {
  const intl = useIntl()
  const line = statsLine(intl, stats)
  const memory = stats ? memoryLabel(intl, stats.memory) : null

  if (line === null) {
    return <Duration duration={duration}/>
  }

  // the wall clock is the wait, so it is what the tooltip adds: the number in
  // the head is what the snippet itself spent
  const waited = typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
    ? (duration / 1000).toFixed(duration < 10000 ? 1 : 0)
    : null

  return (
    <span
      className='result-summary__duration mono'
      title={waited === null
        ? undefined
        : intl.formatMessage({id: 'result.stats_title'}, {time: Math.round(Number(stats.time)), memory, seconds: waited})}
    >
      {line}
    </span>
  )
}

Stats.propTypes = {
  duration: PropTypes.number,
  stats: PropTypes.shape({
    time: PropTypes.number,
    memory: PropTypes.number,
  }),
}

/**
 * What a run did when it left on purpose: `dd()`, `exit()` or `die()` stopped it
 * on a line of the snippet, and nothing about that is a failure.
 *
 * It is said in the run's own voice — a badge and a sentence, no error surface
 * and no struck-through bars — because the run answered what it was asked and
 * then stopped, which is what the line that stopped it was for.
 */
const Ended = ({ended}) => {
  const intl = useIntl()

  return (
    <div className='result-summary result-summary--wrap'>
      <span className='badge'>
        {intl.formatMessage({id: 'result.ended'})}
      </span>
      <span>{endingSentence(intl, ended)}</span>
    </div>
  )
}

Ended.propTypes = {
  ended: PropTypes.shape({
    by: PropTypes.string,
    line: PropTypes.number,
  }).isRequired,
}

/**
 * What one `dump()`/`dd()` was shown, as the same tree a returned value is read
 * in: the line it was dumped from, and the value itself.
 *
 * A dump is not the run's answer, so it is not drawn as one: the value is under a
 * head of its own, inside the statement it was written in, and the run's own head
 * is still the one that says what the run returned.
 */
const Dumped = ({dump}) => {
  const intl = useIntl()
  const line = Number(dump && dump.line)

  return (
    <div className='block__dump'>
      <div className='result-summary result-summary--wrap'>
        <span className='badge'>{intl.formatMessage({id: 'result.dump'})}</span>
        {Number.isInteger(line) && line > 0 && (
          <span className='muted'>{intl.formatMessage({id: 'result.line'}, {line})}</span>
        )}
        <span className='grow'/>
        <span className='result-summary__actions'>
          <button
            className='btn btn--ghost btn--sm'
            type='button'
            title={intl.formatMessage({id: 'result.copy_value'})}
            onClick={() => copy(dump ? dump.value : null)}
          >
            {intl.formatMessage({id: 'result.copy_short'})}
          </button>
        </span>
      </div>

      <Reading value={dump ? dump.value : null} view='organized'/>
    </div>
  )
}

Dumped.propTypes = {
  dump: PropTypes.shape({
    line: PropTypes.number,
    value: PropTypes.any,
  }).isRequired,
}

/** Every dump of a run, in the order they were dumped. */
const Dumps = ({dumps}) => {
  const shown = Array.isArray(dumps) ? dumps.filter(Boolean) : []

  if (shown.length === 0) {
    return null
  }

  return (
    <div className='dumps'>
      {shown.map((dump, index) => <Dumped key={index} dump={dump}/>)}
    </div>
  )
}

Dumps.propTypes = {
  dumps: PropTypes.arrayOf(PropTypes.object),
}

/**
 * Where an error was thrown, in a line: the snippet's own line when it was the
 * snippet that threw, and the file and line of the code when it was not.
 *
 * The two are not the same fact, so they are not written the same way: a line of
 * the snippet is the person's own code and is named by its number, while a file
 * outside it is named by its path, which is not the app's language to translate.
 *
 * @param {IntlShape} intl
 * @param {Object} error
 * @return {String} empty when the envelope did not know
 */
const threwAt = (intl, error) => {
  const line = Number(error.line)

  if (Number.isInteger(line) && line > 0) {
    return intl.formatMessage({id: 'result.line'}, {line})
  }

  if (typeof error.file === 'string' && error.file !== '') {
    return Number.isInteger(Number(error.fileLine)) ? `${error.file}:${error.fileLine}` : error.file
  }

  return ''
}

/**
 * What a frame called: the function, under the class it was called on when there
 * was one. A closure is written as php writes it, because that is where it is.
 *
 * @param {Object} frame
 * @return {String}
 */
const callee = frame => (frame.class ? `${frame.class}->${frame.function}` : frame.function)

/**
 * The frames an exception came through, folded away behind their own disclosure:
 * the class and the words are what a person reads first, and the list of calls
 * is what they open when those are not enough. A run that answered fine never
 * shows one.
 *
 * A frame of the snippet says the line of the snippet it is on and is tinted as
 * the run's own code; every other frame says the file it was called from and the
 * line inside that file.
 *
 * @param {Object} error
 */
const Trace = ({error}) => {
  const intl = useIntl()
  const frames = Array.isArray(error.trace) ? error.trace.filter(Boolean) : []

  if (frames.length === 0) {
    return null
  }

  return (
    <details className='trace trace__group'>
      <summary>
        <span className='tree__caret'/>
        <span className='trace__title'>{intl.formatMessage({id: 'result.trace'})}</span>
      </summary>

      <ol className='trace__frames'>
        {frames.map((frame, index) => (
          <li
            key={index}
            className={`trace__row${frame.snippet ? ' trace__snippet' : ''}`}
          >
            <span className='trace__idx' aria-hidden='true'>{index}</span>
            <span className='trace__file'>
              {frame.snippet
                ? intl.formatMessage({id: 'result.trace_snippet'}, {line: Number(frame.line) || 0})
                : `${frame.file}:${frame.line}`}
            </span>
            <span className='trace__fn'>{callee(frame)}</span>
          </li>
        ))}
      </ol>
    </details>
  )
}

Trace.propTypes = {
  error: PropTypes.shape({
    trace: PropTypes.arrayOf(PropTypes.shape({
      file: PropTypes.string,
      line: PropTypes.number,
      class: PropTypes.string,
      function: PropTypes.string,
      snippet: PropTypes.bool,
    })),
  }).isRequired,
}

/** The run's exception: the class over its message, as the design's surface. */
const Failure = ({error, duration = null, stats = null, markdown = null}) => {
  const intl = useIntl()
  const where = threwAt(intl, error)

  return (
  <>
    <div className='result-summary result-summary--head'>
      <Outcome kind='threw' label animate key={failureKey(error)}/>
      <span className='muted'>{intl.formatMessage({id: 'result.no_value'})}</span>
      <span className='grow'/>
      <Stats stats={stats} duration={duration}/>
      <span className='result-summary__actions'>
        <button
          className='btn btn--ghost btn--sm'
          type='button'
          title={intl.formatMessage({id: 'result.copy_message'})}
          onClick={() => copyText(`${error.class}: ${error.message}`)}
        >
          {intl.formatMessage({id: 'result.copy_short'})}
        </button>

        {markdown && <MarkdownAction {...markdown}/>}
      </span>
    </div>

    <div className='error-surface' role='alert'>
      <div className='error-surface__class mono'>{error.class}</div>
      <p className='error-surface__message mono'>{error.message}</p>
      {where && <p className='error-surface__message mono'>{where}</p>}
    </div>

    <Trace error={error}/>
  </>
  )
}

Failure.propTypes = {
  duration: PropTypes.number,
  stats: PropTypes.object,
  markdown: PropTypes.object,
  error: PropTypes.shape({
    class: PropTypes.string,
    message: PropTypes.string,
    line: PropTypes.number,
    file: PropTypes.string,
    fileLine: PropTypes.number,
    trace: PropTypes.array,
  }).isRequired,
}

/**
 * A finished run with nothing to draw. A block may never have run, and a value
 * inside one is only shown when it is returned or printed.
 */
const NothingReturned = () => (
  <div className='empty empty--benign'>
    <Outcome kind='printed'/>
    <p><FormattedMessage id='result.nothing_returned'/></p>
    <p className='muted'><FormattedMessage id='result.nothing_help'/></p>
  </div>
)

/**
 * One statement of a run that has several: the line it is on, what it answered,
 * and that value in the reading that is on.
 *
 * A statement that threw says so where it threw, which is the line the failure
 * was on rather than the whole run.
 */
const Block = ({block, view, id, ordinal}) => {
  const intl = useIntl()
  const failed = Boolean(block.error)
  const reading = readingOf(view, block.value)
  // the head already says the line the statement starts on, which is the throw's
  // own line for a statement of one line. The surface repeats it only when it is
  // another line, or when the throw was in a file rather than the snippet
  const where = failed && Number(block.error.line) !== Number(block.line) ? threwAt(intl, block.error) : ''

  // the statement is a section so its head pins over its own value and is
  // pushed out by the statement under it, rather than every head of the run
  // stacking at the pane's top edge
  return (
    <section
      className={`block${failed ? ' block--threw' : ''}`}
      id={id}
      tabIndex={-1}
      role='group'
      aria-labelledby={`${id}-line`}
    >
      <div className='result-summary result-summary--head'>
        <span className='block__index' aria-hidden='true'>#{ordinal}</span>
        <span className='block__line' id={`${id}-line`}>
          {intl.formatMessage({id: 'result.line'}, {line: Number(block.line) || 0})}
        </span>
        <Outcome
          key={failed ? failureKey(block.error) : answerKey('returned', block.value)}
          kind={failed ? 'threw' : 'returned'}
          label
          animate
        />
        {failed
          ? <span className='mono'>{block.error.class}</span>
          : (
            <span className='muted'>
              {block.value === null
                ? intl.formatMessage({id: 'result.value_none'})
                : describe(intl, block.value)}
            </span>
          )}
        <span className='grow'/>
        {/* a statement with nothing to show has nothing to copy, and one that
            threw copies the exception it ended on rather than a value it never
            answered */}
        {failed
          ? (
            <span className='result-summary__actions'>
              <button
                className='btn btn--ghost btn--sm'
                type='button'
                title={intl.formatMessage({id: 'result.copy_message'})}
                onClick={() => copyText(`${block.error.class}: ${block.error.message}`)}
              >
                {intl.formatMessage({id: 'result.copy_short'})}
              </button>
            </span>
          )
          : block.value !== null && <ReadingActions value={block.value} view={reading}/>}
      </div>

      {/* what the statement dumped, under its own head: the value is the
          statement's, and it is read the same whether the statement went on to
          answer, to throw or to end the run */}
      <Dumps dumps={block.dumps}/>

      {failed && (
        <>
          <div className='error-surface' role='alert'>
            <div className='error-surface__class mono'>{block.error.class}</div>
            <p className='error-surface__message mono'>{block.error.message}</p>
            {/* the statement's own line is in its head; this is the line of the
                snippet the throw itself was on, which is another line when the
                statement spans several */}
            {where && <p className='error-surface__message mono'>{where}</p>}
          </div>

          <Trace error={block.error}/>
        </>
      )}

      {!failed && block.value !== null && (
        <Reading value={block.value} view={reading}/>
      )}
    </section>
  )
}

Block.propTypes = {
  block: PropTypes.shape({
    line: PropTypes.number,
    value: PropTypes.any,
    dumps: PropTypes.arrayOf(PropTypes.shape({
      line: PropTypes.number,
      value: PropTypes.any,
    })),
    error: PropTypes.shape({
      class: PropTypes.string,
      message: PropTypes.string,
      line: PropTypes.number,
      file: PropTypes.string,
      fileLine: PropTypes.number,
      trace: PropTypes.array,
    }),
  }).isRequired,
  view: PropTypes.oneOf(READINGS).isRequired,
  id: PropTypes.string.isRequired,
  ordinal: PropTypes.number.isRequired,
}

// a run of a handful of statements is read at a glance; the map is for the runs
// whose answer is somewhere below the fold
const MAPPED_FROM = 6

/**
 * What a key of the map says about its statement: the line it is on, and the
 * class that ended it where it threw, so a key is never read to find out what
 * it does. Both are words the rest of the pane already says.
 */
const statementOf = (intl, block) => {
  const line = intl.formatMessage({id: 'result.line'}, {line: Number(block.line) || 0})

  return block.error ? `${line}, ${block.error.class}` : line
}

// the room a jump leaves between the chrome and the statement it brings in, so
// a statement's own hairline is never read as the edge of the pinned row
const JUMP_GAP = 8

/**
 * The box a statement is scrolled inside: the nearest ancestor that scrolls its
 * own content vertically. A box that hides its overflow is not one — the panel
 * wraps the output in a viewport that hides it, and scrolling that instead of
 * the run would crop the pane rather than move the run within it.
 */
const scrollBoxOf = node => {
  for (let box = node.parentElement; box; box = box.parentElement) {
    const overflow = window.getComputedStyle(box).overflowY

    if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay')
      && box.scrollHeight > box.clientHeight) {
      return box
    }
  }

  return null
}

/**
 * Brings a statement in and puts the focus inside it, so the jump a key makes
 * is where a keyboard reader lands too.
 *
 * Only the box the statements are in is moved. A jump is a move within the run,
 * never a move of the app around it: `scrollIntoView` walks every scrollable
 * ancestor, which took the window and the panel's own viewport with it and left
 * the chrome and the statements above the target out of sight. A scroll that
 * was asked for still respects motion: nothing glides where motion is not
 * wanted.
 */
const jumpTo = (id, chrome = null) => {
  const target = document.getElementById(id)

  if (!target) {
    return
  }

  // the keyboard lands on the statement whether or not the pane can move
  target.focus?.({preventScroll: true})

  const box = scrollBoxOf(target)

  if (!box) {
    return
  }

  const still = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  const pane = box.getBoundingClientRect()
  const rect = target.getBoundingClientRect()
  // where the statement stands in the run, whatever the pane is scrolled to
  const inBox = rect.top - pane.top + box.scrollTop
  // what the chrome covers at the pane's top, measured where it is pinned: in a
  // narrow pane the head wraps and the map stays, so a jump clears all of it
  const covered = chrome ? Math.max(0, chrome.getBoundingClientRect().bottom - pane.top) : 0
  // a statement near the end of the run cannot be brought to the chrome: the
  // run ends where it ends, so the box goes as far as it can and the statement
  // is read under the chrome rather than behind it
  const end = Math.max(0, box.scrollHeight - box.clientHeight)
  const top = Math.max(0, Math.min(inBox - covered - JUMP_GAP, end))
  // sideways the pane is left where it was, unless the statement's own head has
  // been scrolled out of it: a wide table is read from its left edge, never
  // from the middle of a row
  const left = rect.left < pane.left - 0.5 ? 0 : box.scrollLeft

  if (typeof box.scrollTo === 'function') {
    box.scrollTo({top, left, behavior: still ? 'auto' : 'smooth'})
  } else {
    box.scrollTop = top
    box.scrollLeft = left
  }
}

/**
 * The statements of a long run, as one row of keys above them: numbered as the
 * run numbers them, and struck through where they threw. The shape of a forty
 * statement run — and the one key that broke it — is read before any of it is
 * scrolled, and every key says where it leads.
 *
 * The map lists what the pane is showing, so filtering the run to its failures
 * leaves a map of those and no key that leads nowhere.
 */
const StatementMap = ({entries, onPick}) => {
  const intl = useIntl()

  return (
    <div
      className='statements-map'
      role='group'
      aria-label={intl.formatMessage({id: 'result.statement_map'})}
    >
      {entries.map(({block, ordinal, id}) => {
        const label = statementOf(intl, block)

        return (
          <button
            key={id}
            className={`statements-map__chip${block.error ? ' statements-map__chip--threw' : ''}`}
            type='button'
            title={label}
            aria-label={`${ordinal}, ${label}`}
            onClick={() => onPick(id)}
          >
            <span aria-hidden='true'>{ordinal}</span>
            {block.error && <Outcome kind='threw'/>}
          </button>
        )
      })}
    </div>
  )
}

StatementMap.propTypes = {
  entries: PropTypes.arrayOf(PropTypes.shape({
    block: PropTypes.object.isRequired,
    ordinal: PropTypes.number.isRequired,
    id: PropTypes.string.isRequired,
  })).isRequired,
  onPick: PropTypes.func.isRequired,
}

/**
 * What the run printed, as the session's console: the one bar says nothing came
 * back, and the text is drawn under it.
 *
 * Its bar is pinned over the text of a run that has no chrome of its own. A run
 * of several statements does have one, so there the bar is `scrolls`: it goes
 * with its text under the controls the pane keeps, rather than claiming the
 * same top edge and disappearing behind them.
 */
const Printed = ({output, markdown = null, scrolls = false}) => {
  const intl = useIntl()

  return (
  <>
    <div className={`result-summary result-summary--head${scrolls ? ' result-summary--scrolls' : ''}`}>
      <Outcome kind='printed' label animate key={output}/>
      <span className='grow'/>
      <span className='result-summary__actions'>
        <button
          className='btn btn--ghost btn--sm'
          type='button'
          title={intl.formatMessage({id: 'result.copy_printed'})}
          onClick={() => copyText(output)}
        >
          {intl.formatMessage({id: 'result.copy_short'})}
        </button>

        {markdown && <MarkdownAction {...markdown}/>}
      </span>
    </div>

    <pre className='printed'>{output}</pre>
  </>
  )
}

Printed.propTypes = {
  output: PropTypes.string.isRequired,
  markdown: PropTypes.object,
  scrolls: PropTypes.bool,
}

/**
 * The readings of a value, in the panel's own tab idiom: a radio per reading,
 * and the accent under the one that is on.
 *
 * The readings are the ones this run has, so the switch never offers a way of
 * reading that would show nothing, and one of them is always on.
 */
const ViewSwitch = ({views, view, onChange}) => {
  const intl = useIntl()
  const group = useRef(null)

  // a pane too narrow for the whole row scrolls it, so the reading in hand is
  // brought back into sight whenever it changes
  useEffect(() => {
    const options = group.current ? [...group.current.querySelectorAll('.view-switch__option')] : []
    const chosen = options.find(option => option.querySelector('input').checked)

    chosen?.scrollIntoView?.({block: 'nearest', inline: 'nearest'})
  }, [view])

  return (
  <span
    className='view-switch'
    ref={group}
    role='radiogroup'
    aria-label={intl.formatMessage({id: 'result.how'})}
  >
    {views.map(option => (
      <label key={option} className='view-switch__option'>
        <input
          type='radio'
          name='result-view'
          checked={view === option}
          onChange={() => onChange(option)}
        />
        {intl.formatMessage({id: `result.${option}`})}
      </label>
    ))}
  </span>
  )
}

ViewSwitch.propTypes = {
  views: PropTypes.arrayOf(PropTypes.oneOf(READINGS)).isRequired,
  view: PropTypes.oneOf(READINGS).isRequired,
  onChange: PropTypes.func.isRequired,
}

/**
 * The value the run returned: what came back, how it is being read, and what
 * that reading shows.
 *
 * The readings read only the value. A run that printed has that print drawn in
 * a block of its own above this one, so the raw reading here is the json the
 * tree is drawn from, and the print is never said twice.
 */
const Returned = ({value, view, onView, duration = null, stats = null, markdown = null}) => {
  const intl = useIntl()
  const views = readingsOf([value])
  const reading = readingOf(view, value)

  return (
    <>
      <div className='result-summary result-summary--head'>
        <Outcome kind='returned' label animate key={answerKey('returned', value)}/>
        <span>{describe(intl, value)}</span>
        <ViewSwitch views={views} view={reading} onChange={onView}/>
        <span className='grow'/>
        <Stats stats={stats} duration={duration}/>
        <ReadingActions value={value} view={reading}>
          {markdown && <MarkdownAction {...markdown}/>}
        </ReadingActions>
      </div>

      <Reading value={value} view={reading}/>
    </>
  )
}

Returned.propTypes = {
  value: PropTypes.any,
  duration: PropTypes.number,
  stats: PropTypes.object,
  markdown: PropTypes.object,
  view: PropTypes.oneOf(READINGS).isRequired,
  onView: PropTypes.func.isRequired,
}

/**
 * What the run aliased into the session before it ran, so the classes the
 * snippet named without naming in full are never silent: a name that was
 * resolved to the wrong class is visible here, next to what the run returned.
 */
const Imported = ({imported}) => {
  const intl = useIntl()
  const entries = Object.entries(imported || {})

  if (entries.length === 0) {
    return null
  }

  const text = entries.map(([name, qualified]) => `${name} → ${qualified}`).join('\n')

  return (
    <div className='result-summary result-summary--wrap'>
      <span className='badge'>
        <FormattedMessage id='result.imported'/>
      </span>
      <span className='mono'>
        {entries.map(([name, qualified], index) => (
          <span key={name}>
            {index > 0 ? <span className='muted'>, </span> : null}
            <span className='t-class'>{name}</span>
            <span className='muted'>{' → '}</span>
            <span className='muted'>{qualified}</span>
          </span>
        ))}
      </span>
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        title={intl.formatMessage({id: 'result.copy_imports'})}
        onClick={() => copyText(text)}
      >
        {intl.formatMessage({id: 'result.copy_short'})}
      </button>
    </div>
  )
}

Imported.propTypes = {
  imported: PropTypes.object,
}

/**
 * What a guarded run did with the transaction it was sent under, above what the
 * run itself did: the guard is the reason none of it is kept, so a dry run is
 * read starting here.
 *
 * The sentence is chosen by guardReport from the outcome the guard reported,
 * never assumed: a transaction that did not hold is an error that says what it
 * may have left behind, and the connections the run reached outside it are
 * listed under it, since nothing on them was ever going to be taken back.
 *
 * Where the guard took back a run that wrote and did not fail, it offers the run
 * again with the transaction kept — the same code, sent as a run of its own,
 * because a run is a session that has answered and gone by the time this is
 * read and there is no transaction left to close. The button's title says the
 * code runs a second time.
 */
const Guard = ({transaction, sandbox, run, onKeep = () => {}}) => {
  const intl = useIntl()
  const report = guardReport(transaction, run)
  const sealed = sandboxReport(sandbox)

  if (!report && !sealed) {
    return null
  }

  // the sandbox is what the transaction could not say: what the run would have
  // done to the world outside the database
  const tone = (sealed && sealed.tone === 'error') || (report && report.tone === 'error') ? 'error' : 'ok'

  return (
    <div className={`result-summary result-summary--wrap guard guard--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {report && <span className='guard__note'>{intl.formatMessage({id: report.id}, report.values)}</span>}
      {sealed && (
        <span className='guard__note'>
          {intl.formatMessage({id: sealed.id}, sealed.values)}
        </span>
      )}
      {sealed && [...sealed.sent, ...sealed.requested].map(line => (
        <span key={line} className='guard__note guard__unguarded mono'>{line}</span>
      ))}
      {sealed && sealed.notSandboxed.map(reason => (
        <span key={reason} className='guard__note guard__unguarded'>
          {intl.formatMessage({id: 'guard.sandbox_not'}, {reason})}
        </span>
      ))}
      {report && report.unguarded.map(({connection, count}) => (
        <span key={connection} className='guard__note guard__unguarded'>
          {intl.formatMessage({id: report.unguardedId}, {count, connection})}
        </span>
      ))}
      {report && report.keep && (
        <button
          className='btn btn--ghost btn--sm'
          type='button'
          title={intl.formatMessage({id: 'guard.keep_title'})}
          onClick={onKeep}
        >
          {intl.formatMessage({id: 'guard.keep'})}
        </button>
      )}
    </div>
  )
}

Guard.propTypes = {
  onKeep: PropTypes.func,
  run: PropTypes.object,
  sandbox: PropTypes.shape({
    channels: PropTypes.object,
    sent: PropTypes.array,
    requested: PropTypes.array,
    not_sandboxed: PropTypes.array,
  }),
  transaction: PropTypes.shape({
    mode: PropTypes.string,
    armed: PropTypes.bool,
    connection: PropTypes.string,
    statements: PropTypes.number,
    outcome: PropTypes.string,
    error: PropTypes.string,
    unguarded: PropTypes.object,
  }),
}

const Result = ({result, view = 'organized', onView = () => {}, onKeep = () => {}, allStatements = false, code = '', connection = ''}) => {
  const intl = useIntl()
  // the ids a statement is found by: one run at a time, and a prefix of its own
  // so they never name the same thing twice
  const runId = useId().replace(/:/g, '')
  // the row the pane keeps: what a jump has to bring a statement in below
  const chromeRef = useRef(null)
  // the filter belongs to the answer it was set on: a new answer is read from
  // the top rather than with statements nobody asked this run to hide
  const [failedOnlyOn, setFailedOnlyOn] = useState(null)
  const onlyFailed = failedOnlyOn === result
  const {value, error, output, imported, blocks, transaction, sandbox, duration, stats, ended} = result
  // every dump the run was shown, whichever statement it was in: a run of one
  // statement reads them under the run's head, a run of several inside the
  // statement each belongs to
  const dumps = (Array.isArray(blocks) ? blocks : []).flatMap(block => (block && Array.isArray(block.dumps) ? block.dumps : []))

  // what a Markdown export needs beyond the envelope: the snippet the run was
  // sent with, and the connection it ran on
  const markdown = {result, code, connection}

  // a run of several statements, read statement by statement: the value of the
  // run is the last one's, so this is what "every statement" means
  if (allStatements && blocks && blocks.length > 1) {
    const views = readingsOf(blocks.map(block => block.value))
    const numbered = blocks.map((block, index) => ({
      block,
      ordinal: index + 1,
      id: `${runId}-statement-${index + 1}`,
    }))
    const threw = numbered.filter(entry => entry.block.error)
    const shown = onlyFailed && threw.length > 0 ? threw : numbered
    const mapped = blocks.length >= MAPPED_FROM

    return (
      <>
        {/* the run's own controls and, for a long run, the map of its
            statements: the one row the pane keeps. It is where the run is read
            from, so it stands at the top and is pinned there over everything
            the run printed and every statement under it */}
        <div className='run-chrome' ref={chromeRef}>
          <div className='result-summary result-summary--head'>
            <Outcome
              key={error ? failureKey(error) : answerKey('returned', value)}
              kind={error ? 'threw' : 'returned'}
              label
              animate
            />
            <span>{intl.formatMessage({id: 'result.statements'}, {count: blocks.length})}</span>
            <ViewSwitch views={views} view={onReading(views, view)} onChange={onView}/>
            <span className='grow'/>
            <Stats stats={stats} duration={duration}/>
            <span className='result-summary__actions'>
              {threw.length > 0 && (
                <span className='badge badge--error'>
                  {intl.formatMessage({id: 'result.threw_count'}, {count: threw.length})}
                </span>
              )}
              {threw.length > 0 && (
                <button
                  className='btn btn--ghost btn--sm'
                  type='button'
                  aria-pressed={onlyFailed}
                  onClick={() => setFailedOnlyOn(onlyFailed ? null : result)}
                >
                  <FormattedMessage id='result.failed_only'/>
                </button>
              )}
              <MarkdownAction {...markdown}/>
            </span>
          </div>

          {mapped && (
            <StatementMap
              entries={shown}
              onPick={id => jumpTo(id, chromeRef.current)}
            />
          )}
        </div>

        {/* a run that left on purpose says so before anything it did, because
            it is why the run stopped */}
        {ended && <Ended ended={ended}/>}

        <Guard transaction={transaction} sandbox={sandbox} run={result} onKeep={onKeep}/>

        {/* what the guard took back, row by row, under its own report */}
        <ResultChanges transaction={transaction}/>

        <Imported imported={imported}/>

        {/* what the run printed is read under the run's chrome, so its bar
            scrolls with its text rather than claiming the top edge too */}
        {output && <Printed output={output} markdown={markdown} scrolls/>}

        <div className={`blocks${mapped ? ' blocks--mapped' : ''}`}>
          {shown.map(({block, ordinal, id}) => (
            // several statements can share a line, so the line alone is not a
            // key; the map names the same number in the same order
            <Block key={id} block={block} view={view} id={id} ordinal={ordinal}/>
          ))}

          {/* a run that ended outside every statement — exit, a fatal error,
              a session that died — has its failure on the run, not on a block */}
          {error && !blocks.some(block => block.error) && <Failure error={error} stats={stats} markdown={markdown}/>}
        </div>
      </>
    )
  }

  return (
    <>
      {/* the run ended on purpose: everything it answered before that stands
          under this line, and nothing about it is a failure */}
      {ended && <Ended ended={ended}/>}

      <Guard transaction={transaction} sandbox={sandbox} run={result} onKeep={onKeep}/>

      <ResultChanges transaction={transaction}/>

      <Imported imported={imported}/>

      {/* what `dump()` was shown, as the values it was shown, above what the run
          printed and returned: a run of one statement has no statement head of
          its own to put them under */}
      <Dumps dumps={dumps}/>

      {/* what a run that failed printed first is kept: `exit()` and `dd()` end
          the run after they have printed what they were for */}
      {error && output && <Printed output={output} markdown={markdown}/>}

      {error && <Failure error={error} duration={duration} stats={stats} markdown={markdown}/>}

      {/* a run that printed and returned nothing is read as it printed */}
      {!error && value === null && output && <Printed output={output} markdown={markdown}/>}

      {/* one statement can both print and answer: the print is a fact of its
          own, drawn above the value the way a run of several statements draws
          it, rather than hidden in one of the value's readings. The run's one
          markdown action stays with the value, so it is offered once */}
      {!error && value !== null && output && <Printed output={output}/>}

      {/* and the value itself is read in the reading that is on */}
      {!error && value !== null && (
        <Returned
          value={value}
          view={view}
          onView={onView}
          duration={duration}
          stats={stats}
          markdown={markdown}
        />
      )}

      {/* a run that ended in dd() or exit() already says why it has no value */}
      {!error && value === null && !output && !ended && dumps.length === 0 && <NothingReturned/>}
    </>
  )
}

Result.propTypes = {
  view: PropTypes.oneOf(READINGS),
  onView: PropTypes.func,
  onKeep: PropTypes.func,
  allStatements: PropTypes.bool,
  code: PropTypes.string,
  connection: PropTypes.string,
  result: PropTypes.shape({
    value: PropTypes.any,
    error: PropTypes.shape({
      class: PropTypes.string,
      message: PropTypes.string,
      line: PropTypes.number,
      file: PropTypes.string,
      fileLine: PropTypes.number,
      trace: PropTypes.array,
    }),
    output: PropTypes.string,
    imported: PropTypes.object,
    transaction: PropTypes.object,
    ranAt: PropTypes.string,
    stats: PropTypes.shape({
      time: PropTypes.number,
      memory: PropTypes.number,
    }),
    ended: PropTypes.shape({
      by: PropTypes.string,
      line: PropTypes.number,
    }),
  }).isRequired,
}

export default Result
