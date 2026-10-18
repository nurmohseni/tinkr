/**
 * The form's values, as php source.
 *
 * Kept apart from the form itself because this is the part that has to be
 * right: a value written into a snippet is code, and what a field holds is
 * whatever a person typed. Nothing here imports electron, so it can be read and
 * tested on its own.
 */

/**
 * A value as the php literal it is.
 *
 * php-form's own `stringify` writes a value between quotes as it is, which is
 * how a snippet form used to run whatever a field held: a field set to
 * `'; system('id'); //` closed the string and the rest of it ran as code. So the
 * literal is written here, where escaping is the point: a string is single
 * quoted the way php reads one — backslashes and single quotes escaped, nothing
 * else touched — and every other type is what it says it is.
 *
 * Numbers and booleans arrive as text, because a form field is text: a value
 * that is a number to php is written as one only when the field says it is a
 * number, and an integer field left empty is written as `null` rather than as
 * `''`, which is what it was read from.
 *
 * @param {any} value
 * @param {String} [type] the field's type, as the form read it
 * @return {String} php source
 */
const phpLiteral = (value, type) => {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (Array.isArray(value) || typeof value === 'object') {
    // a list or a map is written as one, with the same rules for what it holds
    const entries = Object.entries(value).map(([key, item]) => {
      const at = /^\d+$/.test(key) ? key : phpLiteral(key, 'text')

      return `${at} => ${phpLiteral(item, typeof item === 'number' ? 'number' : 'text')}`
    })

    return `[${entries.join(', ')}]`
  }

  if (typeof value === 'boolean' || value === 'true' || value === 'false') {
    return String(value) === 'true' || value === true ? 'true' : 'false'
  }

  const text = String(value)

  if (type === 'number' || type === 'range') {
    // a number field that holds something that is not a number is a string, and
    // running it as one is what the person typed
    return /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text.trim()) ? text.trim() : phpLiteral(text)
  }

  if (/^(integer|int)$/.test(type || '')) {
    const trimmed = text.trim()

    if (trimmed === '') {
      return 'null'
    }

    return /^-?\d+$/.test(trimmed) ? trimmed : phpLiteral(text)
  }

  // everything else is a string, and a string is what php will read back as
  // exactly the characters it holds
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * The snippet's code with every field's value written into it.
 *
 * The field's own assignment is what is replaced, and only the value part of it:
 * `$field_name = <literal>;` keeps whatever came before the `=` — a comment, a
 * cast, a call — and whatever the assignment is followed by. A field the code no
 * longer holds is left out rather than appended, because a form is the code's
 * form and not a list of its own.
 *
 * @param {String} code
 * @param {Array<{name: String, value: any, type?: String}>} fields
 * @return {String}
 */
const writeFields = (code, fields) => {
  let source = String(code)

  for (const field of fields) {
    const name = String(field.name || '')
    const bare = name.replace(/^\$/, '')

    if (!bare) {
      continue
    }

    // `$field_name = …;` up to the `;` that closes it, which is not inside a
    // string or a bracket: the value may be a closure, an array or a call
    const at = source.search(new RegExp(`\\$${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`))

    if (at === -1) {
      continue
    }

    const start = source.indexOf('=', at) + 1
    const end = endOfValue(source, start)

    if (end === -1) {
      continue
    }

    source = `${source.slice(0, start)} ${phpLiteral(field.value, field.type)}${source.slice(end)}`
  }

  return source
}

/**
 * Where the value that starts at an offset ends: at the `;` that closes the
 * statement it is part of, which is the first `;` outside a string, a comment
 * and a bracket.
 *
 * @param {String} source
 * @param {Number} from
 * @return {Number} the offset of the `;`, or -1 when there is none
 */
const endOfValue = (source, from) => {
  let depth = 0
  let quote = null

  for (let at = from; at < source.length; at++) {
    const char = source[at]

    if (quote) {
      if (char === '\\') {
        at++
      } else if (char === quote) {
        quote = null
      }

      continue
    }

    if (char === '\'' || char === '"') {
      quote = char
      continue
    }

    if (char === '/' && source[at + 1] === '/') {
      const lineEnd = source.indexOf('\n', at)

      at = lineEnd === -1 ? source.length : lineEnd
      continue
    }

    if (char === '/' && source[at + 1] === '*') {
      const close = source.indexOf('*/', at + 2)

      at = close === -1 ? source.length : close + 1
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      depth++
      continue
    }

    if (char === ')' || char === ']' || char === '}') {
      depth--
      continue
    }

    if (char === ';' && depth === 0) {
      return at
    }
  }

  return -1
}

module.exports = {
  phpLiteral,
  writeFields,
  endOfValue,
}
