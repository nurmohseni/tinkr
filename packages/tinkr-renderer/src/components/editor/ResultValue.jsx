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

/** A composite node, in the design's `array · 5 items` shape. */
const TypeLabel = ({value}) => {
  const intl = useIntl()
  const isList = Array.isArray(value)

  return (
    <>
      <span className='t-class'>{intl.formatMessage({id: isList ? 'result.array' : 'result.object'})}</span>
      <span className='tree__sep'>·</span>
      <span className='t-number'>{entriesOf(value).length}</span>
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

export default ResultValue
