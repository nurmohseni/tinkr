import {DOT_R, MAX_NODES, ROW_H, autoOpen, layoutGraph, nodeId} from '../graphLayout'

const textOf = (name, value) => ({
  key: name === null ? '' : String(name),
  value: Array.isArray(value) ? `[${value.length}]` : value !== null && typeof value === 'object' ? '{...}' : String(value),
  className: 't-string',
  full: String(value),
})

const value = {app: {name: 'Tinkr', debug: true}, users: [{id: 1}, {id: 2}]}

const paths = graph => graph.nodes.map(node => node.path.join('.'))

describe('test autoOpen', () => {
  test('should open a small value the whole way, so the graph is a reading of something', () => {
    expect([...autoOpen(value)].sort()).toEqual(['[]', '["app"]', '["users"]', '["users",0]', '["users",1]'].sort())
  })

  test('should open the root of a value too big to open at all', () => {
    const open = autoOpen({items: Array.from({length: 500}, (_, index) => ({index}))})

    expect([...open]).toEqual(['[]'])
  })

  test('should stop opening once the budget is spent', () => {
    expect([...autoOpen({items: [0, 1, 2, 3, 4]}, 7)]).toEqual(['[]', '["items"]'])
    expect([...autoOpen({items: [0, 1, 2, 3, 4]}, 6)]).toEqual(['[]'])
  })
})

describe('test layoutGraph', () => {
  test('should draw a node per open path, and an edge from each parent to each child', () => {
    const graph = layoutGraph(value, autoOpen(value), textOf)

    expect(paths(graph)).toContain('users.0.id')
    expect(graph.edges).toHaveLength(graph.nodes.length - 1)
    expect(graph.more).toBe(0)
  })

  test('should name an edge by the two nodes it joins, both of which it draws', () => {
    const graph = layoutGraph(value, autoOpen(value), textOf)
    const ids = new Set(graph.nodes.map(node => node.id))

    expect(new Set(graph.nodes.map(node => node.id)).size).toBe(graph.nodes.length)

    for (const edge of graph.edges) {
      expect(ids.has(edge.parent)).toBe(true)
      expect(ids.has(edge.child)).toBe(true)
      expect(edge.d).not.toContain('NaN')
    }
  })

  test('should draw nothing under a node that is not showing its children, and know it could', () => {
    const graph = layoutGraph(value, new Set(), textOf)

    expect(paths(graph)).toEqual([''])
    expect(graph.nodes[0].children).toBe(true)
    expect(graph.nodes[0].open).toBe(false)
    expect(graph.edges).toEqual([])
  })

  test('should give every node of a depth one column, wider than anything said in it', () => {
    const graph = layoutGraph(value, autoOpen(value), textOf)
    const columns = new Map()

    for (const node of graph.nodes) {
      columns.set(node.depth, (columns.get(node.depth) || new Set()).add(node.x))
    }

    const depths = [...columns.keys()].sort((a, b) => a - b)
    const lefts = depths.map(depth => [...columns.get(depth)])

    // a depth is a column: one x each, in order from the root outwards
    expect(lefts.map(xs => xs.length)).toEqual(depths.map(() => 1))
    expect(depths).toEqual([...Array(depths.length).keys()])

    for (let index = 1; index < depths.length; index += 1) {
      expect(lefts[index][0]).toBeGreaterThan(lefts[index - 1][0])
    }
  })

  test('should sit a parent between its children, and count its own rows', () => {
    const graph = layoutGraph(value, autoOpen(value), textOf)
    const leaves = graph.nodes.filter(node => !node.children)
    const root = graph.nodes[0]

    expect(graph.height).toBe(leaves.length * ROW_H)
    expect(root.y).toBe((leaves[0].y + leaves[leaves.length - 1].y) / 2)
  })

  test('should leave a column room for the separator the render draws', () => {
    const open = new Set([nodeId([])])
    const tight = layoutGraph({a: 'b'}, open, textOf, '')
    const spaced = layoutGraph({a: 'b'}, open, textOf, ': ')

    // the label the render draws between the two is what a column has to hold,
    // separator and all, or the widest node of a column runs into the next one
    expect(spaced.width).toBeGreaterThan(tight.width)
  })

  test('should not lay out more than the cap allows, and say how many there were', () => {
    const flat = Object.fromEntries(Array.from({length: 500}, (_, index) => [`key${index}`, index]))
    const graph = layoutGraph(flat, new Set([nodeId([])]), textOf)

    expect(graph.nodes).toHaveLength(MAX_NODES)
    expect(graph.more).toBe(101)
  })

  test('should keep an edge in the gap between the two columns and land it on the dot', () => {
    const small = {a: 1, b: 2}
    const graph = layoutGraph(small, autoOpen(small), textOf)
    const [edge] = graph.edges
    const root = graph.nodes[0]
    const child = graph.nodes.find(node => node.id === edge.child)
    const rail = Number(edge.d.match(/-?\d+(\.\d+)?/)[0])

    expect(edge.d).toContain(`M ${rail} ${root.y}`)
    expect(rail).toBeGreaterThan(root.x)
    expect(rail).toBeLessThan(child.x - DOT_R)
    expect(edge.d.endsWith(`H ${child.x - DOT_R}`)).toBe(true)
  })
})
