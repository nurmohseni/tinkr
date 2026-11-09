/**
 * A tool's arguments, checked against the schema the tool declares.
 *
 * Every tool says what its arguments are called, what each one is, and that
 * nothing else is sent (`additionalProperties: false`). That declaration is not
 * decoration: a client that writes `{"code": "…", "dry_run": true}` has asked
 * for something this tool cannot do, and a server that ignores the key runs the
 * code for real — the one mistake a dry-run guard exists to prevent. It is also
 * the difference between an argument a tool meant to take and one a model
 * guessed at: `timeout` for `timeout_ms` is a run that waits the default minute
 * and never says why.
 *
 * So the arguments are read against the schema before the tool sees them, and
 * what does not fit is a protocol error naming the argument, with the ones the
 * tool does take listed beside it (the JSON-RPC layer turns it into -32602).
 *
 * This reads the part of JSON Schema these schemas use — an object of typed
 * properties, required ones, an enum, a list of enums, and a range on a number —
 * and nothing else. There are no references, combinators or defaults here
 * because none of the tools declare one, and a validator for what a server does
 * not say is a validator nobody reads.
 */

// the words an argument's expected type is said in, for a message a model can
// act on: "a whole number" is a fix, "integer" is a schema keyword
const words = {
  string: 'a string',
  number: 'a number',
  integer: 'a whole number',
  boolean: 'true or false',
  array: 'a list',
  object: 'an object',
  null: 'nothing',
}

/**
 * @param {any} value
 * @return {String} what JSON Schema would call it
 */
const typeOf = value => {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number'
  }

  return typeof value
}

/**
 * @param {String|Array<String>} type one type, or the ones that are allowed
 * @return {String}
 */
const typeWords = type => (Array.isArray(type)
  ? type.map(one => words[one] || one).join(' or ')
  : (words[type] || type))

/**
 * Whether a value is of a declared type. An integer is a number, and nothing
 * else is anything else.
 *
 * @param {any} value
 * @param {String} type
 * @return {Boolean}
 */
const isA = (value, type) => {
  const actual = typeOf(value)

  return type === 'number' ? actual === 'number' || actual === 'integer' : actual === type
}

/**
 * Arguments that were not sent. A client that serialises an absent optional as
 * `null` sent nothing, which is how every tool here reads it already.
 *
 * @param {any} value
 * @return {Boolean}
 */
const absent = value => value === undefined || value === null

/**
 * An argument the tool does not have, said with the ones it does: a model that
 * wrote `dry_run` can fix the call from this sentence alone.
 *
 * @param {Object} tool the tool that was called
 * @param {String} at the path the argument is at, as a message names it
 * @return {String}
 */
const unknownArgument = (tool, at) => {
  const taken = Object.keys(tool.inputSchema.properties || {})

  return taken.length === 0
    ? `\`${at}\` is not an argument ${tool.name} takes: it takes none.`
    : `\`${at}\` is not an argument ${tool.name} takes. It takes: ${taken.join(', ')}.`
}

/**
 * One value against one property schema, and its items when it is a list.
 *
 * @param {Object} schema
 * @param {any} value
 * @param {String} at
 * @return {String|null} what is wrong with it, as a sentence a caller can act on
 */
const problemAt = (schema, value, at) => {
  const types = schema.type === undefined ? [] : [].concat(schema.type)

  if (types.length && !types.some(type => isA(value, type))) {
    return `\`${at}\` has to be ${typeWords(schema.type)}, not ${typeWords(typeOf(value))}.`
  }

  if (schema.enum && !schema.enum.some(one => one === value)) {
    return `\`${at}\` has to be one of ${schema.enum.map(one => JSON.stringify(one)).join(', ')}, ` +
      `not ${JSON.stringify(value)}.`
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      return `\`${at}\` has to be at least ${schema.minimum}: it was ${value}.`
    }

    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      return `\`${at}\` has to be at most ${schema.maximum}: it was ${value}.`
    }
  }

  if (Array.isArray(value) && schema.items) {
    for (let index = 0; index < value.length; index++) {
      const problem = problemAt(schema.items, value[index], `${at}[${index}]`)

      if (problem) {
        return problem
      }
    }
  }

  return null
}

/**
 * What is wrong with a call's arguments, if anything.
 *
 * @param {Object} tool a tool as it is listed, with its `name` and `inputSchema`
 * @param {Object} args what the call sent
 * @return {String|null}
 */
const problemOf = (tool, args) => {
  const schema = tool && tool.inputSchema

  if (!schema || !schema.properties) {
    return null
  }

  for (const key of Object.keys(args)) {
    if (absent(args[key])) {
      continue
    }

    if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
      if (schema.additionalProperties === false) {
        return unknownArgument(tool, key)
      }

      continue
    }

    const problem = problemAt(schema.properties[key], args[key], key)

    if (problem) {
      return problem
    }
  }

  for (const key of schema.required || []) {
    if (absent(args[key])) {
      return `\`${key}\` is required: it was not sent.`
    }
  }

  return null
}

module.exports = {
  typeOf,
  typeWords,
  problemAt,
  problemOf,
}
