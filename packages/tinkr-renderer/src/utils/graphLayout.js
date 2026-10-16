import {isComposite, entriesOf} from './resultReading'

/**
 * Where every node and every edge of the graph reading sits.
 *
 * A left-to-right tidy tree: one column per depth, one row per node, a parent
 * centred on the children it is showing. It is pure geometry, so what the
 * reading draws can be read here and tested without a browser.
 */

export const ROW_H = 26

// past this the graph is a wall of marks: it stops and says how much it left,
// and the rest of the value is a click away on the node it stopped under
export const MAX_NODES = 400

const COL_GAP = 40
export const DOT_GUTTER = 14
export const DOT_R = 3.5
const CHAR_W = 7.8
const CORNER = 6

/** What the render draws between a node's key and its value, character for
 * character, because a column has to be wide enough for the whole label. */
export const LABEL_SEP = ': '

/** The identity of a node: its path from the root, which no key can forge. */
export const nodeId = path => JSON.stringify(path)

/** How many nodes a value has, showing only what the open set opens. */
const count = (value, path, open) => {
  const children = isComposite(value) ? entriesOf(value) : []

  if (children.length === 0 || !open.has(nodeId(path))) {
    return 1
  }

  return 1 + children.reduce((sum, [name, item]) => sum + count(item, [...path, name], open), 0)
}

/**
 * What a small value opens to: everything, until the budget is spent, with the
 * root always open — a graph of one node is not a reading of anything.
 *
 * @param {any} value
 * @param {Number} budget
 * @return {Set<String>}
 */
export const autoOpen = (value, budget = 60) => {
  const open = new Set()
  const queue = [[[], value]]
  let visible = 0

  while (queue.length > 0) {
    const [path, item] = queue.shift()
    const children = isComposite(item) ? entriesOf(item) : []

    visible += 1

    if (children.length === 0) {
      continue
    }

    if (path.length > 0 && visible + children.length > budget) {
      continue
    }

    open.add(nodeId(path))
    children.forEach(([name, child]) => queue.push([[...path, name], child]))
  }

  return open
}

/**
 * @param {any} value the value to lay out
 * @param {Set<String>} open the ids of the nodes that are showing their children
 * @param {Function} textOf `(name, value) => {key, value: String, className: String}`
 * @param {String} separator what the render joins a key and a value with
 * @return {{nodes: Array, edges: Array, width: Number, height: Number, more: Number}}
 */
export const layoutGraph = (value, open, textOf, separator = LABEL_SEP) => {
  const total = count(value, [], open)
  const room = {left: MAX_NODES}

  const build = (item, path, name, depth) => {
    const children = isComposite(item) ? entriesOf(item) : []
    const showing = children.length > 0 && open.has(nodeId(path))
    const node = {
      id: nodeId(path),
      path,
      name,
      depth,
      children: children.length > 0,
      open: showing,
      text: textOf(name, item),
      childNodes: [],
    }

    room.left -= 1

    if (showing) {
      // the cap holds the whole reading, not each branch: a collection of ten
      // thousand rows is the case this exists for, and it is all one branch
      node.childNodes = []

      for (const [childName, child] of children) {
        if (room.left <= 0) {
          break
        }

        node.childNodes.push(build(child, [...path, childName], childName, depth + 1))
      }
    }

    return node
  }

  const root = build(value, [], null, 0)

  // one column per depth, as wide as the widest thing said in it
  const widths = []

  const measure = node => {
    const label = node.text.key ? node.text.key + separator + node.text.value : node.text.value
    const width = DOT_GUTTER + Math.round(label.length * CHAR_W)

    widths[node.depth] = Math.max(widths[node.depth] || 0, width)
    node.childNodes.forEach(measure)
  }

  measure(root)

  const leftOf = depth => widths.slice(0, depth).reduce((sum, width) => sum + width + COL_GAP, 0)

  const place = node => {
    node.x = leftOf(node.depth)
    node.childNodes.forEach(place)
  }

  place(root)

  // rows: a leaf takes the next one, a parent sits between its children
  const nodes = []
  let row = 0

  const stack = node => {
    if (node.childNodes.length === 0) {
      node.y = row * ROW_H + ROW_H / 2
      row += 1
    } else {
      node.childNodes.forEach(stack)
      node.y = (node.childNodes[0].y + node.childNodes[node.childNodes.length - 1].y) / 2
    }

    nodes.push(node)
  }

  stack(root)

  const edges = []

  for (const node of [...nodes].reverse()) {
    if (node.childNodes.length === 0) {
      continue
    }

    const rail = node.x + widths[node.depth] + COL_GAP / 2

    for (const child of node.childNodes) {
      const end = child.x - DOT_R
      const down = Math.sign(child.y - node.y)
      const turn = Math.min(CORNER, Math.abs(child.y - node.y) / 2, end - rail)

      edges.push({
        id: `${node.id}>${child.id}`,
        parent: node.id,
        child: child.id,
        d: Math.abs(child.y - node.y) < 0.5 || turn <= 0
          ? `M ${rail} ${node.y} H ${end}`
          : `M ${rail} ${node.y} V ${child.y - down * turn}` +
            ` Q ${rail} ${child.y} ${rail + turn} ${child.y} H ${end}`,
      })
    }
  }

  return {
    nodes: nodes.sort((a, b) => a.depth - b.depth || a.y - b.y),
    edges,
    // every column, the gap between columns, and the gutter a label sits behind
    // its own dot once more at the end: the widest label of the last column is
    // the right-hand edge of the graph, and it must not end on it
    width: widths.reduce((sum, width) => sum + width, 0) + COL_GAP * (widths.length - 1) + DOT_GUTTER,
    height: row * ROW_H,
    more: total - nodes.length,
  }
}
