import PropTypes from 'prop-types'
import {useState} from 'react'
import {useIntl} from 'react-intl'

import {copy} from '../../utils/clipboard'
import {
  entriesOf,
  isComposite,
  scalarClass,
  scalarText,
} from '../../utils/resultReading'

/**
 * The value tree: one node per key, the leaves carrying the design's
 * colour-coded types, and a copy button on every node.
 *
 * It is the organized reading of a value, and the only reading that is drawn
 * the same whatever the value is: the table, the graph and the frame each have
 * something to say about a shape of their own, and all of them fall back to
 * this one for a value they cannot read.
 */

// the design's tree carries three indentation steps; anything deeper stays on
// the third, because a fourth one is not in the stylesheet
const rowClass = depth => (depth > 0 ? `tree__row tree__row--d${Math.min(depth, 3)}` : 'tree__row')

const CopyValueButton = ({value}) => {
  const intl = useIntl()

  return (
  <button
    className='tree__copy'
    type='button'
    title={intl.formatMessage({id: 'result.copy_value'})}
    onClick={event => {
      // the row around it is a disclosure, and copying must not fold it
      event.preventDefault()
      event.stopPropagation()
      copy(value)
    }}
  >
    {intl.formatMessage({id: 'result.copy'})}
  </button>
  )
}

CopyValueButton.propTypes = {
  value: PropTypes.any,
}

/** A composite node, in the design's `array · 5 items` shape: the count once. */
const TypeLabel = ({value}) => {
  const intl = useIntl()
  const isList = Array.isArray(value)

  return (
    <>
      <span className='t-class'>{intl.formatMessage({id: isList ? 'result.array' : 'result.object'})}</span>
      <span className='tree__sep'>·</span>
      <span className='muted'>
        {intl.formatMessage({id: isList ? 'result.items' : 'result.keys'}, {count: entriesOf(value).length})}
      </span>
    </>
  )
}

TypeLabel.propTypes = {
  // a list is labelled too, which is why this is not an object alone
  value: PropTypes.oneOfType([PropTypes.object, PropTypes.array]).isRequired,
}

// how much of a string the tree draws before it asks. A row is one line of text,
// and a string of megabytes laid out as one line is wider than the browser will
// paint, so the pane came up blank; past this it is cut, and the rest is one
// click away, wrapped so it paints at any length
export const LONG_STRING = 2000

const LongString = ({value}) => {
  const intl = useIntl()
  const [whole, setWhole] = useState(false)
  const text = scalarText(value)

  return (
    <span className={`${scalarClass(value)} tree__long`}>
      {whole ? text : `${text.slice(0, LONG_STRING)}…`}
      {!whole && (
        <button
          className='btn btn--ghost btn--sm tree__more'
          type='button'
          onClick={event => {
            // the row may be a disclosure, and this must not fold it
            event.preventDefault()
            event.stopPropagation()
            setWhole(true)
          }}
        >
          {intl.formatMessage({id: 'result.show_all'}, {count: value.length})}
        </button>
      )}
    </span>
  )
}

LongString.propTypes = {
  value: PropTypes.string.isRequired,
}

const Value = ({value}) => {
  if (isComposite(value)) {
    return <TypeLabel value={value}/>
  }

  if (typeof value === 'string' && value.length > LONG_STRING) {
    return <LongString value={value}/>
  }

  return <span className={scalarClass(value)}>{scalarText(value)}</span>
}

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
const ResultValue = ({value, depth, prefix = null}) => {
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

export default ResultValue
