/**
 * What a class says about itself in prose.
 *
 * A docblock is not decoration: a facade writes the whole surface of the manager
 * behind it as `@method` lines, an untyped magic property as `@property`, and a
 * class that borrows another one's members says so with `@mixin`. Reading it is
 * how a popup knows that `Cache::` has `remember()` when the class itself
 * declares thirteen methods.
 *
 * Everything here is a string in, a shape out: types are left as written, so the
 * class that reads them can settle `self` and the class it is read on.
 */
const {typeExpression} = require('./modelIntel')

/**
 * The lines of a docblock, without the decoration around them.
 *
 * @param {String} doc
 * @returns {Array<String>}
 */
const lines = doc => {
  return String(doc)
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*\/\*\*?/, '').replace(/\*\/\s*$/, '').replace(/^\s*\*+/, '').trim())
}

/**
 * A docblock, read.
 *
 * The summary is the prose before the first tag — what the class is for, which is
 * what a popup shows under the name. `returns` and `params` are the block's own,
 * for a class that documents them, and `methods`, `properties`, `mixins` and `see`
 * are the members it declares on behalf of itself or another class.
 *
 * @param {String|null} doc a raw `/** … *\/` comment
 * @returns {{summary: String, returns: String|null, params: Array<String>, methods: Array<Object>, properties: Array<Object>, mixins: Array<String>, see: Array<String>}}
 */
const parse = doc => {
  const parsed = {
    summary: '',
    returns: null,
    params: [],
    methods: [],
    properties: [],
    mixins: [],
    see: [],
  }

  if (!doc) {
    return parsed
  }

  const all = lines(doc)
  let index = 0

  // the summary is the prose before the tags, and it ends at the first blank line:
  // what follows a blank line is the description, which no popup has room for
  while (index < all.length && !all[index].startsWith('@')) {
    if (all[index] === '') {
      if (parsed.summary !== '') {
        index += 1
        break
      }
    } else {
      parsed.summary = parsed.summary === '' ? all[index] : parsed.summary + ' ' + all[index]
    }

    index += 1
  }

  // a tag can be written over several lines — a facade's `@method` lines are long —
  // so a line that starts with nothing is a continuation of the tag above it
  const tags = []

  for (; index < all.length; index += 1) {
    const line = all[index]

    if (line === '') {
      continue
    }

    if (line.startsWith('@')) {
      const space = line.search(/\s/)
      tags.push({
        name: (space === -1 ? line.slice(1) : line.slice(1, space)).toLowerCase(),
        text: space === -1 ? '' : line.slice(space + 1).trim(),
      })
    } else if (tags.length) {
      tags[tags.length - 1].text = (tags[tags.length - 1].text + ' ' + line).trim()
    }
  }

  for (const tag of tags) {
    if (tag.name === 'method') {
      const method = methodOf(tag.text)

      if (method) {
        parsed.methods.push(method)
      }
    } else if (tag.name === 'property' || tag.name === 'property-read' || tag.name === 'property-write') {
      const property = propertyOf(tag.text, tag.name !== 'property-write', tag.name !== 'property-read')

      if (property) {
        parsed.properties.push(property)
      }
    } else if (tag.name === 'mixin') {
      const mixin = tag.text.split(/\s+/)[0]

      if (mixin) {
        parsed.mixins.push(mixin.replace(/^\\+/, ''))
      }
    } else if (tag.name === 'see') {
      const reference = tag.text.split(/\s+/)[0]

      if (reference) {
        parsed.see.push(reference)
      }
    } else if (tag.name === 'return') {
      parsed.returns = typeExpression(tag.text) || null
    } else if (tag.name === 'param') {
      const text = tag.text.trim()

      if (text) {
        parsed.params.push(text)
      }
    }
  }

  return parsed
}

/**
 * One `@method` line: `static Type name(params)`.
 *
 * The type is optional — a facade can write `@method int forget(string $key)` and
 * also `@method static scope()` — so the name is whatever identifier sits just
 * before the parenthesis, and the type is whatever is left in front of it.
 *
 * @param {String} text
 * @returns {{name: String, static: Boolean, returns: String|null, params: Array<String>}|null}
 */
const methodOf = text => {
  let rest = String(text == null ? '' : text).trim()
  const isStatic = /^static\b/.test(rest)

  if (isStatic) {
    rest = rest.slice('static'.length).trim()
  }

  const matched = /^(.*?)([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/.exec(rest)

  if (!matched) {
    return null
  }

  return {
    name: matched[2],
    static: isStatic,
    returns: typeExpression(matched[1]) || null,
    params: splitParams(matched[3]),
  }
}

/**
 * One `@property` line: `Type $name`.
 *
 * @param {String} text
 * @param {Boolean} read
 * @param {Boolean} write
 * @returns {{name: String, type: String|null, read: Boolean, write: Boolean}|null}
 */
const propertyOf = (text, read, write) => {
  const written = String(text == null ? '' : text).trim()
  const matched = /\$([A-Za-z_][A-Za-z0-9_]*)/.exec(written)

  if (!matched) {
    return null
  }

  return {
    name: matched[1],
    type: typeExpression(written.slice(0, matched.index)) || null,
    read,
    write,
  }
}

/**
 * The parameters of a written signature, split at the commas between them.
 *
 * @param {String} text
 * @returns {Array<String>}
 */
const splitParams = text => {
  const written = String(text == null ? '' : text).trim()

  if (!written) {
    return []
  }

  const params = []
  let depth = 0
  let quote = null
  let start = 0

  for (let index = 0; index < written.length; index += 1) {
    const character = written[index]

    if (quote) {
      if (character === quote && written[index - 1] !== '\\') {
        quote = null
      }
    } else if (character === '\'' || character === '"') {
      quote = character
    } else if ('<([{'.includes(character)) {
      depth += 1
    } else if ('>)]}'.includes(character)) {
      depth -= 1
    } else if (character === ',' && depth === 0) {
      params.push(written.slice(start, index).trim())
      start = index + 1
    }
  }

  params.push(written.slice(start).trim())

  return params.filter(param => param !== '')
}

module.exports = {parse}
