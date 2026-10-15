import {useState} from 'react'
import PropTypes from 'prop-types'

/**
 * The result of the last run, as the design's value tree.
 *
 * The value comes from the session as json, so the app knows the shape of what
 * came back but not the class behind it: a node is drawn as `array`/`object`
 * with its size, and the leaves carry the design's colour-coded types. What the
 * design shows beyond that — the class name, the line of the throw, the frame
 * list, the query log — is not in the run result.
 *
 * A value is read in one of two ways, and the run's own strip carries the one
 * that is on: the tree, node by node, or the text the tree is drawn from. A run
 * that printed is read as it printed in both, because its raw reading would say
 * the same words twice.
 */

const isComposite = value => value !== null && typeof value === 'object'

const entriesOf = value => (Array.isArray(value)
  ? value.map((item, index) => [index, item])
  : Object.entries(value))

const scalarClass = value => {
  switch (typeof value) {
    case 'number':
      return 't-number'
    case 'boolean':
      return 't-bool'
    case 'string':
      return 't-string'
    default:
      return 't-null'
  }
}

const scalarText = value => (typeof value === 'string' ? JSON.stringify(value) : String(value))

// the design's tree carries three indentation steps; anything deeper stays on
// the third, because a fourth one is not in the stylesheet
const rowClass = depth => (depth > 0 ? `tree__row tree__row--d${Math.min(depth, 3)}` : 'tree__row')

const copy = value => navigator.clipboard.writeText(
  typeof value === 'string' ? value : JSON.stringify(value, null, 2),
)

/**
 * The value's shape in the design's words: `3 items`, `2 keys`, or the type of
 * a leaf.
 *
 * @param {any} value
 * @return {String}
 */
const shape = value => {
  if (Array.isArray(value)) {
    return `${value.length} items`
  }

  if (isComposite(value)) {
    return `${Object.keys(value).length} keys`
  }

  return typeof value
}

const CopyValueButton = ({value}) => (
  <button
    className='tree__copy'
    type='button'
    title='Copy value'
    onClick={event => {
      // the row around it is a disclosure, and copying must not fold it
      event.preventDefault()
      event.stopPropagation()
      copy(value)
    }}
  >
    copy
  </button>
)

CopyValueButton.propTypes = {
  value: PropTypes.any,
}

/** A composite node, in the design's `array · 5 items` shape. */
const TypeLabel = ({value}) => (
  <>
    <span className='t-class'>{Array.isArray(value) ? 'array' : 'object'}</span>
    <span className='tree__sep'>·</span>
    <span className='t-number'>{entriesOf(value).length}</span>
    <span className='muted'>{Array.isArray(value) ? ' items' : ' keys'}</span>
  </>
)

TypeLabel.propTypes = {
  value: PropTypes.object.isRequired,
}

const Value = ({value}) => (
  isComposite(value)
    ? <TypeLabel value={value}/>
    : <span className={scalarClass(value)}>{scalarText(value)}</span>
)

Value.propTypes = {
  value: PropTypes.any,
}

/** The `customer: ` before a child, `0 => ` for a list. */
const KeyPrefix = ({name}) => {
  const isIndex = typeof name === 'number'

  return (
    <>
      <span className={isIndex ? 't-number' : 'tree__key'}>{name}</span>
      <span className='tree__sep'>{isIndex ? ' => ' : ': '}</span>
    </>
  )
}

KeyPrefix.propTypes = {
  name: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
}

/**
 * One node of the tree: a `<details>` when there is something under it, a row
 * when there is not. The root is the only node open on arrival.
 */
const ResultValue = ({value, depth, prefix}) => {
  const [open, setOpen] = useState(depth === 0)
  const entries = isComposite(value) ? entriesOf(value) : []
  const row = (
    <>
      <span className='tree__caret'/>
      {prefix}
      <Value value={value}/>
      <CopyValueButton value={value}/>
    </>
  )

  if (entries.length === 0) {
    return <div className={rowClass(depth)}>{row}</div>
  }

  return (
    <details open={open} onToggle={event => setOpen(event.target.open)}>
      <summary className={rowClass(depth)}>{row}</summary>

      {entries.map(([name, item]) => (
        <ResultValue
          key={name}
          value={item}
          depth={depth + 1}
          prefix={<KeyPrefix name={name}/>}
        />
      ))}
    </details>
  )
}

ResultValue.propTypes = {
  value: PropTypes.any,
  depth: PropTypes.number.isRequired,
  prefix: PropTypes.node,
}

ResultValue.defaultProps = {
  prefix: null,
}

/** The run's exception: the class over its message, as the design's surface. */
const Failure = ({error}) => (
  <>
    <div className='result-summary'>
      <span className='badge badge--error'><span className='dot dot--error'/>threw</span>
      <span className='muted'>no value returned</span>
      <span className='grow'/>
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        title='Copy the exception class and message'
        onClick={() => navigator.clipboard.writeText(`${error.class}: ${error.message}`)}
      >
        Copy message
      </button>
    </div>

    <div className='error-surface' role='alert'>
      <div className='error-surface__class mono'>{error.class}</div>
      <p className='error-surface__message mono'>{error.message}</p>
    </div>
  </>
)

Failure.propTypes = {
  error: PropTypes.shape({
    class: PropTypes.string,
    message: PropTypes.string,
  }).isRequired,
}

/** The run finished with nothing to draw: no value, and nothing printed either. */
const NothingReturned = () => (
  <div className='empty empty--benign'>
    <span className='empty__icon' aria-hidden='true'>
      <svg width='14' height='14' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.3'>
        <circle cx='8' cy='8' r='6.2'/>
        <path d='M8 4.8v4.4M8 11.4v.2' strokeLinecap='round'/>
      </svg>
    </span>
    <p>This snippet did not return a value.</p>
    <p className='muted'>It printed nothing either.</p>
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
  const failed = block.error !== null

  return (
    <>
      <div className='result-summary'>
        <span className='block__line'>Line {block.line}</span>
        {failed
          ? (
            <span className='badge badge--error'>
              <span className='dot dot--error'/>{block.error.class}
            </span>
          )
          : (
            <span className='badge badge--success'><span className='dot dot--live'/>ok</span>
          )}
        {!failed && (
          <span className='muted'>
            {block.value === null ? 'no value' : `${shape(block.value)} returned`}
          </span>
        )}
        <span className='grow'/>
        <button
          className='btn btn--ghost btn--sm'
          type='button'
          title='Copy the value as JSON'
          onClick={() => navigator.clipboard.writeText(JSON.stringify(block.value, null, 2))}
        >
          Copy
        </button>
      </div>

      {failed && (
        <div className='error-surface' role='alert'>
          <div className='error-surface__class mono'>{block.error.class}</div>
          <p className='error-surface__message mono'>{block.error.message}</p>
        </div>
      )}

      {!failed && block.value !== null && (
        view === 'raw'
          ? <pre className='printed'>{JSON.stringify(block.value, null, 2)}</pre>
          : (
            <div className='tree'>
              <ResultValue value={block.value} depth={0}/>
            </div>
          )
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
  view: PropTypes.oneOf(['organized', 'raw']).isRequired,
}

/**
 * What the run printed, as the session's console: the badge says it is the
 * session's own words, and the text is drawn under it.
 */
const Printed = ({output}) => (
  <>
    <div className='result-summary'>
      <span className='badge'><span className='dot dot--accent'/>printed</span>
      <span className='grow'/>
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        title='Copy what the run printed'
        onClick={() => navigator.clipboard.writeText(output)}
      >
        Copy
      </button>
    </div>

    <pre className='printed'>{output}</pre>
  </>
)

Printed.propTypes = {
  output: PropTypes.string.isRequired,
}

/**
 * The two readings of one value, in the panel's own tab idiom: a radio, and the
 * accent under the reading that is on.
 */
const ViewSwitch = ({view, onChange}) => (
  <span className='view-switch' role='radiogroup' aria-label='How to read the result'>
    {['organized', 'raw'].map(option => (
      <label key={option} className='view-switch__option'>
        <input
          type='radio'
          name='result-view'
          checked={view === option}
          onChange={() => onChange(option)}
        />
        {option}
      </label>
    ))}
  </span>
)

ViewSwitch.propTypes = {
  view: PropTypes.oneOf(['organized', 'raw']).isRequired,
  onChange: PropTypes.func.isRequired,
}

/**
 * The value the run returned: what came back, how it is being read, and what
 * that reading shows — the tree, or the text it is drawn from.
 *
 * A run that printed wrote the raw reading of its value itself, in psysh's
 * words, so that text is what the raw reading shows; a run that printed nothing
 * is read raw as the json the tree is drawn from. Either way the two readings
 * are alternatives: one replaces the other, and neither is said twice.
 */
const Returned = ({value, view, onView, output}) => {
  const json = JSON.stringify(value, null, 2)
  const raw = output || json
  // the copy carries what the reading shows
  const copy = view === 'raw' ? raw : json

  return (
    <>
      <div className='result-summary'>
        <span className='badge badge--success'><span className='dot dot--live'/>ok</span>
        <span>{shape(value)} returned</span>
        <ViewSwitch view={view} onChange={onView}/>
        <span className='grow'/>
        <button
          className='btn btn--ghost btn--sm'
          type='button'
          title={view === 'raw' ? 'Copy what is shown' : 'Copy the value as JSON'}
          onClick={() => navigator.clipboard.writeText(copy)}
        >
          Copy
        </button>
      </div>

      {view === 'raw'
        ? <pre className='printed'>{raw}</pre>
        : (
          <div className='tree'>
            <ResultValue value={value} depth={0}/>
          </div>
        )}
    </>
  )
}

Returned.propTypes = {
  value: PropTypes.any,
  output: PropTypes.string,
  view: PropTypes.oneOf(['organized', 'raw']).isRequired,
  onView: PropTypes.func.isRequired,
}

Returned.defaultProps = {
  output: '',
}

/**
 * What the run aliased into the session before it ran, so the classes the
 * snippet named without naming in full are never silent: a name that was
 * resolved to the wrong class is visible here, next to what the run returned.
 */
const Imported = ({imported}) => {
  const entries = Object.entries(imported || {})

  if (entries.length === 0) {
    return null
  }

  const text = entries.map(([name, qualified]) => `${name} → ${qualified}`).join('\n')

  return (
    <div className='result-summary'>
      <span className='badge'><span className='dot dot--accent'/>imported</span>
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
      <span className='grow'/>
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        title='Copy the imports'
        onClick={() => navigator.clipboard.writeText(text)}
      >
        Copy
      </button>
    </div>
  )
}

Imported.propTypes = {
  imported: PropTypes.object,
}

const Result = ({result, view, onView, allStatements}) => {
  const {value, error, output, imported, blocks} = result

  // a run of several statements, read statement by statement: the value of the
  // run is the last one's, so this is what "every statement" means
  if (allStatements && blocks && blocks.length > 1) {
    return (
      <>
        <Imported imported={imported}/>

        {output && <Printed output={output}/>}

        <div className='result-summary'>
          {error
            ? (
              <span className='badge badge--error'>
                <span className='dot dot--error'/>{error.class}
              </span>
            )
            : (
              <span className='badge badge--success'><span className='dot dot--live'/>ok</span>
            )}
          <span>{blocks.length} statements</span>
          <ViewSwitch view={view} onChange={onView}/>
        </div>

        {blocks.map(block => (
          <Block key={block.line} block={block} view={view}/>
        ))}
      </>
    )
  }

  return (
    <>
      <Imported imported={imported}/>

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
  view: PropTypes.oneOf(['organized', 'raw']),
  onView: PropTypes.func,
  allStatements: PropTypes.bool,
  result: PropTypes.shape({
    value: PropTypes.any,
    error: PropTypes.shape({
      class: PropTypes.string,
      message: PropTypes.string,
    }),
    output: PropTypes.string,
    imported: PropTypes.object,
  }).isRequired,
}

Result.defaultProps = {
  view: 'organized',
  onView: () => {},
  allStatements: false,
}

export default Result
