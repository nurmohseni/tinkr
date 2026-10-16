import PropTypes from 'prop-types'
import {useCallback, useMemo, useState} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'

import {
  autoOpen,
  DOT_GUTTER,
  DOT_R,
  LABEL_SEP,
  layoutGraph,
  nodeId,
} from '../../utils/graphLayout'
import {
  compositeText,
  isComposite,
  scalarClass,
  scalarText,
  truncate,
} from '../../utils/resultReading'

/**
 * The graph reading of a value: the same nodes as the tree, laid out left to
 * right, so the shape of a wide value is read at once instead of folded away.
 *
 * A node that has something under it opens and closes on click, and is reached
 * from the keyboard; a leaf does not pretend to be a control. Nothing is drawn
 * as a box — a dot and a label per node — and the pointer lights the path from
 * the root to the node it is on, which is how a node is named in a graph this
 * wide.
 *
 * @param {any} value
 */

// a node's label is one line of a graph, so it is cut to what a column can
// show: a value of a megabyte must not make every column a screen wide
const KEY_CHARS = 24
const NODE_CHARS = 40

const ResultGraph = ({value}) => {
  const intl = useIntl()
  const [state, setState] = useState(() => ({value, open: autoOpen(value)}))
  const [highlight, setHighlight] = useState(null)

  // another value is another graph: it opens on its own terms, rather than on
  // the ids the last value happened to have
  if (state.value !== value) {
    setState({value, open: autoOpen(value)})
    setHighlight(null)
  }

  const textOf = useCallback((name, item) => {
    const label = isComposite(item) ? compositeText(intl, item) : scalarText(item)
    const drawn = truncate(label, NODE_CHARS)

    return {
      key: name === null ? '' : truncate(String(name), KEY_CHARS),
      value: drawn,
      className: isComposite(item) ? 't-class' : scalarClass(item),
      full: drawn === label ? null : label,
    }
  }, [intl])

  const graph = useMemo(() => layoutGraph(value, state.open, textOf), [value, state.open, textOf])

  // the way the pointer came: every node from the root down to the one under
  // it, so a wide graph still says where a value sits
  const lit = useMemo(() => {
    const node = graph.nodes.find(candidate => candidate.id === highlight)

    return node ? new Set(node.path.map((_, index) => nodeId(node.path.slice(0, index + 1)))) : null
  }, [graph, highlight])

  const toggle = node => {
    const open = new Set(state.open)

    if (open.has(node.id)) {
      open.delete(node.id)
    } else {
      open.add(node.id)
    }

    setState({value, open})
  }

  return (
    <div className='graph' onMouseLeave={() => setHighlight(null)}>
      <svg
        className='graph__canvas'
        width={graph.width}
        height={graph.height}
        viewBox={`0 0 ${graph.width} ${graph.height}`}
      >
        <g>
          {graph.edges.map(edge => (
            <path
              key={edge.id}
              className={`graph__edge${lit && lit.has(edge.child) ? ' graph__edge--lit' : ''}`}
              d={edge.d}
            />
          ))}
        </g>

        {graph.nodes.map(node => (
          <g
            key={node.id}
            className={[
              'graph__node',
              node.children ? 'graph__node--parent' : '',
              lit && lit.has(node.id) ? 'graph__node--lit' : '',
            ].join(' ').trim()}
            role={node.children ? 'button' : undefined}
            tabIndex={node.children ? 0 : undefined}
            aria-expanded={node.children ? node.open : undefined}
            onClick={node.children ? () => toggle(node) : undefined}
            onKeyDown={node.children && (event => {
              if (event.key === 'Enter' || event.key === ' ') {
                // space would scroll the pane out from under the graph
                event.preventDefault()
                toggle(node)
              }
            })}
            onMouseEnter={() => setHighlight(node.id)}
          >
            {node.text.full && <title>{node.text.full}</title>}

            <circle
              className={`graph__dot${node.children ? ` graph__dot--${node.open ? 'open' : 'closed'}` : ''}`}
              cx={node.x + DOT_R}
              cy={node.y}
              r={DOT_R}
            />

            {/* only a node that opens is reached from the keyboard, so only it
                carries the ring the focus is drawn in */}
            {node.children && (
              <circle className='graph__ring' cx={node.x + DOT_R} cy={node.y} r={DOT_R + 3.5}/>
            )}

            <text x={node.x + DOT_GUTTER} y={node.y} dominantBaseline='central'>
              {node.text.key && <tspan className='tree__key'>{node.text.key}</tspan>}
              {node.text.key && <tspan className='tree__sep'>{LABEL_SEP}</tspan>}
              <tspan className={node.text.className}>{node.text.value}</tspan>
            </text>
          </g>
        ))}
      </svg>

      {graph.more > 0 && (
        <p className='graph__more muted'>
          <FormattedMessage id='result.more_nodes' values={{count: graph.more}}/>
        </p>
      )}
    </div>
  )
}

ResultGraph.propTypes = {
  value: PropTypes.any,
}

export default ResultGraph
