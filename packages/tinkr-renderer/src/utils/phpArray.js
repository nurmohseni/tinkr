import {isComposite, entriesOf} from './resultReading'

/**
 * A value as php code, the way it would be written by hand: the reading a php
 * developer wants out of a result they are about to paste into a test or a
 * seeder.
 *
 * The shape follows the tree: a list of consecutive integer keys from zero is
 * `[...]`, everything else keeps its keys.
 */

const INDENT = '    '

const isList = value => Array.isArray(value) ||
  (isComposite(value) && entriesOf(value).every(([name], index) => String(name) === String(index)))

/**
 * A key php itself would read as an integer. Php coerces a numeric string key to
 * an int, so `'2' => 'a'` and `2 => 'a'` are the same array, and the second is
 * the one a person writes.
 */
const intKey = name => /^(0|-?[1-9][0-9]*)$/.test(String(name)) && Number.isSafeInteger(Number(name))

const keyOf = name => intKey(name) ? String(name) : scalar(String(name))

const scalar = value => {
  if (value === null) {
    return 'null'
  }

  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null'
  }

  return 'null'
}

const write = (value, depth) => {
  if (!isComposite(value)) {
    return scalar(value)
  }

  const entries = entriesOf(value)

  if (entries.length === 0) {
    return '[]'
  }

  const pad = INDENT.repeat(depth + 1)
  const list = isList(value)
  const lines = entries.map(([name, item]) => `${pad}${list ? '' : `${keyOf(name)} => `}${write(item, depth + 1)},`)

  return `[\n${lines.join('\n')}\n${INDENT.repeat(depth)}]`
}

/**
 * @param {any} value
 * @return {String}
 */
export const toPhpArray = value => write(value, 0)
