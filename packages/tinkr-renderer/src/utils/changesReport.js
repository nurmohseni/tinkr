import {CELL_CHARS, isComposite, plainValue, scalarText, truncate} from './resultReading'

/**
 * What a guarded run changed, read from the envelope for the pane.
 *
 * The run's changes arrive as one flat list — a row, its table, its operation,
 * the columns either side — because that is what the wrapper can write while it
 * runs. Reading them is grouping them: a table's rows belong together, and a
 * change is only useful with the columns it actually changed. A created row has
 * nothing before it, a deleted one nothing after it, and both are read as what
 * they are rather than as an update from or to nothing.
 *
 * A value is written the way the value tree writes one — a string quoted, a
 * number bare — and cut to a cell's width, since a change report is a row of the
 * pane and not a place to read a document. A composite value is its json, which
 * is the one-line form of it.
 *
 * The list the wrapper sends is capped (fifty rows, a hundred kilobytes), so
 * `total` is what the run changed and `cut` says whether the pane is showing all
 * of it. The writes nothing could describe — a query-builder update, a raw
 * statement, a truncate — travel with the count and the first few as SQL.
 *
 * @param {Object|undefined} transaction the envelope's `transaction`
 * @return {{total: Number, shown: Number, cut: Boolean, groups: Array,
 *           undiffed: Object|null}|null} null for a run that changed nothing
 */
export const changesReport = transaction => {
  if (!transaction || typeof transaction !== 'object') {
    return null
  }

  const changes = Array.isArray(transaction.changes) ? transaction.changes : []
  const total = Number.isFinite(transaction.changesTotal) ? transaction.changesTotal : changes.length
  const undiffedCount = Number(transaction.undiffed && transaction.undiffed.count) || 0
  const sample = Array.isArray(transaction.undiffed && transaction.undiffed.sample)
    ? transaction.undiffed.sample.filter(sql => typeof sql === 'string' && sql !== '')
    : []

  if (changes.length === 0 && undiffedCount === 0) {
    return null
  }

  const groups = []
  const byKey = new Map()

  for (const change of changes) {
    if (!change || typeof change !== 'object') {
      continue
    }

    const connection = change.connection || null
    const table = String(change.table || '')
    const id = `${connection || ''}\u0000${table}`

    if (!byKey.has(id)) {
      const group = {connection, table, rows: []}

      byKey.set(id, group)
      groups.push(group)
    }

    byKey.get(id).rows.push({
      // an operation this build does not know is still a change, and is read as
      // one rather than dropped
      op: ['created', 'updated', 'deleted'].includes(change.op) ? change.op : 'other',
      key: keyText(change.key),
      columns: columnsOf(change),
    })
  }

  return {
    total,
    shown: changes.length,
    cut: total > changes.length,
    groups,
    undiffed: undiffedCount > 0 ? {count: undiffedCount, sample} : null,
  }
}

/**
 * The columns a change touched, either side of it.
 *
 * An update names the columns that changed, and so does the list the wrapper
 * sends: `before` and `after` are only those columns. A created row's columns
 * are its values, a deleted row's are its last values.
 *
 * @param {Object} change
 * @return {Array<{name: String, before: any, after: any}>}
 */
const columnsOf = change => {
  const before = change.before && typeof change.before === 'object' ? change.before : {}
  const after = change.after && typeof change.after === 'object' ? change.after : {}
  const names = [...Object.keys(before), ...Object.keys(after).filter(name => !(name in before))]

  return names.map(name => ({name, before: before[name], after: after[name]}))
}

/**
 * A row's key, as one line: `id 1`, or the columns of a key that is more than
 * one. Nothing when the row had no key to name.
 *
 * @param {Object|null} key
 * @return {String|null}
 */
export const keyText = key => {
  if (!key || typeof key !== 'object') {
    return null
  }

  const entries = Object.entries(key)

  if (entries.length === 0) {
    return null
  }

  return entries.map(([name, value]) => `${name} ${valueText(value)}`).join(', ')
}

/**
 * A value as one line of a change report: the value tree's spelling for a leaf,
 * and the json of anything composite.
 *
 * @param {any} value
 * @return {String}
 */
export const valueText = value => {
  // a value a column held is written as the value it was, without what the
  // envelope says about it: a change report is data, not notes about data
  const text = isComposite(value) ? JSON.stringify(plainValue(value)) : scalarText(value)

  return truncate(text, CELL_CHARS)
}
