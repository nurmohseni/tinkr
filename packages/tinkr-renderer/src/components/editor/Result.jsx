import {useCallback, useEffect, useRef, useState} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'
import PropTypes from 'prop-types'

import Outcome from '../Outcome'
import PointerMenu from '../PointerMenu'
import ResultGraph from './ResultGraph'
import ResultHtml from './ResultHtml'
import ResultTable from './ResultTable'
import ResultValue from './ResultValue'
import {copy, copyText} from '../../utils/clipboard'
import {guardReport} from '../../utils/guardReport'
import {
  entriesOf,
  isComposite,
  READINGS,
  readingOf,
  readingsOf,
  tableOf,
  toCsv,
} from '../../utils/resultReading'

/**
 * The result of the last run, as the design's value tree.
 *
 * The value comes from the session as json, so the app knows the shape of what
 * came back but not the class behind it: a node is drawn as `array`/`object`
 * with its size, and the leaves carry the design's colour-coded types. What the
 * design shows beyond that — the class name, the line of the throw, the frame
 * list, the query log — is not in the run result.
 *
 * A value is read in one of several ways, and the run's own strip carries the
 * one that is on: the tree, the table of a list of records, the graph of
 * anything with something under it, the frame for a string that is markup, and
 * the text the value is drawn from. The readings a run does not have are not
 * offered, and a value a chosen reading does not have is read as its tree,
 * which is why a reading is never a blank pane.
 *
 * A run that printed is read as it printed in the raw reading, because its
 * raw reading would otherwise say the same words twice.
 */

// the landing is drawn once per run, and React draws an element again only when
// its key says it is another one: an outcome is keyed by what the run answered,
// so a run landing where the last one stood replays the landing rather than
// keeping the glyph that is already there. A value is named by its type and its
// size, which keeps the key cheap; the tree under it is the reading that counts.
const answerKey = (kind, value) => (value !== null && typeof value === 'object'
  ? `${kind}:${Array.isArray(value) ? 'array' : 'object'}:${entriesOf(value).length}`
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
  if (Array.isArray(value)) {
    return intl.formatMessage({id: 'result.items'}, {count: value.length})
  }

  if (isComposite(value)) {
    return intl.formatMessage({id: 'result.keys'}, {count: Object.keys(value).length})
  }

  const id = {
    number: 'result.returned_number',
    string: 'result.returned_string',
    boolean: 'result.returned_boolean',
  }[typeof value]

  return id ? intl.formatMessage({id}) : null
}

const json = value => JSON.stringify(value, null, 2)

/** The reading the switch shows as on: a view this run does not have is its tree. */
const onReading = (views, view) => (views.includes(view) ? view : 'organized')

/**
 * The body of one reading: what that reading shows of the value, and nothing
 * else. Everything a reading needs to say about itself is in the strip above
 * it, so this is one surface whichever reading is on.
 */
const Reading = ({value, view, output = ''}) => {
  switch (view) {
    case 'raw':
      return <pre className='printed'>{output || json(value)}</pre>
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
  output: PropTypes.string,
}

/**
 * What a reading does with the whole of itself, in the strip's own buttons: a
 * table is copied and saved as a csv, and every other reading copies what it
 * shows — the text it read, or the json the tree and the graph are drawn from.
 */
const ReadingActions = ({value, view, output = ''}) => {
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
      </span>
    )
  }

  return (
    <span className='result-summary__actions'>
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        title={intl.formatMessage({id: view === 'raw' ? 'result.copy_shown' : 'result.copy_json'})}
        onClick={() => (view === 'raw' ? copyText(output || json(value)) : copy(value))}
      >
        {intl.formatMessage({id: 'result.copy_short'})}
      </button>
    </span>
  )
}

ReadingActions.propTypes = {
  value: PropTypes.any,
  view: PropTypes.oneOf(READINGS).isRequired,
  output: PropTypes.string,
}

/** The run's exception: the class over its message, as the design's surface. */
const Failure = ({error}) => {
  const intl = useIntl()

  return (
  <>
    <div className='result-summary result-summary--head'>
      <Outcome kind='threw' label animate key={failureKey(error)}/>
      <span className='muted'>{intl.formatMessage({id: 'result.no_value'})}</span>
      <span className='grow'/>
      <span className='result-summary__actions'>
        <button
          className='btn btn--ghost btn--sm'
          type='button'
          title={intl.formatMessage({id: 'result.copy_message'})}
          onClick={() => copyText(`${error.class}: ${error.message}`)}
        >
          {intl.formatMessage({id: 'result.copy_short'})}
        </button>
      </span>
    </div>

    <div className='error-surface' role='alert'>
      <div className='error-surface__class mono'>{error.class}</div>
      <p className='error-surface__message mono'>{error.message}</p>
    </div>
  </>
  )
}

Failure.propTypes = {
  error: PropTypes.shape({
    class: PropTypes.string,
    message: PropTypes.string,
  }).isRequired,
}

/** The run finished with nothing to draw: no value, and nothing printed either. */
const NothingReturned = () => (
  <div className='empty empty--benign'>
    <Outcome kind='printed'/>
    <p><FormattedMessage id='result.nothing_returned'/></p>
    <p className='muted'><FormattedMessage id='result.nothing_printed'/></p>
  </div>
)

/**
 * One statement of a run that has several: the line it is on, what it answered,
 * and that value in the reading that is on.
 *
 * A statement that threw says so where it threw, which is the line the failure
 * was on rather than the whole run.
 */
const Block = ({block, view}) => {
  const intl = useIntl()
  const failed = Boolean(block.error)
  const reading = readingOf(view, block.value)

  return (
    <>
      <div className='result-summary result-summary--head'>
        <span className='block__line'>
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
        <ReadingActions value={block.value} view={reading}/>
      </div>

      {failed && (
        <div className='error-surface' role='alert'>
          <div className='error-surface__class mono'>{block.error.class}</div>
          <p className='error-surface__message mono'>{block.error.message}</p>
        </div>
      )}

      {!failed && block.value !== null && (
        <Reading value={block.value} view={reading}/>
      )}
    </>
  )
}

Block.propTypes = {
  block: PropTypes.shape({
    line: PropTypes.number,
    value: PropTypes.any,
    error: PropTypes.shape({
      class: PropTypes.string,
      message: PropTypes.string,
    }),
  }).isRequired,
  view: PropTypes.oneOf(READINGS).isRequired,
}

/**
 * What the run printed, as the session's console: the one bar says nothing came
 * back, and the text is drawn under it.
 */
const Printed = ({output}) => {
  const intl = useIntl()

  return (
  <>
    <div className='result-summary result-summary--head'>
      <Outcome kind='printed' label animate key={output}/>
      <span className='grow'/>
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        title={intl.formatMessage({id: 'result.copy_printed'})}
        onClick={() => copyText(output)}
      >
        {intl.formatMessage({id: 'result.copy_short'})}
      </button>
    </div>

    <pre className='printed'>{output}</pre>
  </>
  )
}

Printed.propTypes = {
  output: PropTypes.string.isRequired,
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
 * A run that printed wrote the raw reading of its value itself, in psysh's
 * words, so that text is what the raw reading shows; a run that printed nothing
 * is read raw as the json the tree is drawn from. Either way the readings are
 * alternatives: one replaces the other, and neither is said twice.
 */
const Returned = ({value, view, onView, output = ''}) => {
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
        <ReadingActions value={value} view={reading} output={output}/>
      </div>

      <Reading value={value} view={reading} output={output}/>
    </>
  )
}

Returned.propTypes = {
  value: PropTypes.any,
  output: PropTypes.string,
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
const Guard = ({transaction, run, onKeep = () => {}}) => {
  const intl = useIntl()
  const report = guardReport(transaction, run)

  if (!report) {
    return null
  }

  return (
    <div className={`result-summary result-summary--wrap guard guard--${report.tone}`} role={report.tone === 'error' ? 'alert' : undefined}>
      <span className='guard__note'>{intl.formatMessage({id: report.id}, report.values)}</span>
      {report.unguarded.map(({connection, count}) => (
        <span key={connection} className='guard__note guard__unguarded'>
          {intl.formatMessage({id: report.unguardedId}, {count, connection})}
        </span>
      ))}
      {report.keep && (
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

const Result = ({result, view = 'organized', onView = () => {}, onKeep = () => {}, allStatements = false}) => {
  const intl = useIntl()
  const {value, error, output, imported, blocks, transaction} = result

  // a run of several statements, read statement by statement: the value of the
  // run is the last one's, so this is what "every statement" means
  if (allStatements && blocks && blocks.length > 1) {
    const views = readingsOf(blocks.map(block => block.value))

    return (
      <>
        <Guard transaction={transaction} run={result} onKeep={onKeep}/>

        <Imported imported={imported}/>

        {output && <Printed output={output}/>}

        <div className='result-summary result-summary--head'>
          <Outcome
            key={error ? failureKey(error) : answerKey('returned', value)}
            kind={error ? 'threw' : 'returned'}
            label
            animate
          />
          <span>{intl.formatMessage({id: 'result.statements'}, {count: blocks.length})}</span>
          <ViewSwitch views={views} view={onReading(views, view)} onChange={onView}/>
        </div>

        {blocks.map((block, index) => (
          // several statements can share a line, so the line alone is not a key
          <Block key={`${index}:${block.line}`} block={block} view={view}/>
        ))}

        {/* a run that ended outside every statement — exit, a fatal error, a
            session that died — has its failure on the run, not on a block */}
        {error && !blocks.some(block => block.error) && <Failure error={error}/>}
      </>
    )
  }

  return (
    <>
      <Guard transaction={transaction} run={result} onKeep={onKeep}/>

      <Imported imported={imported}/>

      {/* what a run that failed printed first is kept: `exit()` and `dd()` end
          the run after they have printed what they were for */}
      {error && output && <Printed output={output}/>}

      {error && <Failure error={error}/>}

      {/* a run that printed and returned nothing is read as it printed */}
      {!error && value === null && output && <Printed output={output}/>}

      {/* and a run that returned a value is read one way or the other: what it
          printed is the raw reading of that value, and is drawn with it */}
      {!error && value !== null && (
        <Returned
          value={value}
          view={view}
          onView={onView}
          output={output}
        />
      )}

      {!error && value === null && !output && <NothingReturned/>}
    </>
  )
}

Result.propTypes = {
  view: PropTypes.oneOf(READINGS),
  onView: PropTypes.func,
  onKeep: PropTypes.func,
  allStatements: PropTypes.bool,
  result: PropTypes.shape({
    value: PropTypes.any,
    error: PropTypes.shape({
      class: PropTypes.string,
      message: PropTypes.string,
    }),
    output: PropTypes.string,
    imported: PropTypes.object,
    transaction: PropTypes.object,
  }).isRequired,
}

export default Result
