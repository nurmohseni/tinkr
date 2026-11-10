/**
 * What a variable holds, read out of the snippet it is written in.
 *
 * `$user->` can only be answered when something knows what `$user` is, and a
 * snippet has no file, no project index and no language server of its own —
 * all it has is its text. Php reads that text one way, so the type of an
 * expression is decided here from the tokens `phpScanner` already knows how to
 * blank and split, and the return types come from the caller's resolver, which
 * knows the classes of the project. Whatever the resolver cannot type stays
 * unknown: an unknown type is `null`, never a guess, because a wrong member
 * list is worse than an empty one.
 *
 * The walk is one pass over the tokens before the caret. It keeps the value of
 * the chain being built (`$user`, `User::first()`, `now()`), what that chain is
 * assigned to at the end of the statement, and the bindings the snippet itself
 * declares: a `foreach`, a `catch`, a closure parameter, a `@var` docblock.
 *
 * A type is one of
 *
 *   {name}          an object of that class
 *   {name, item}    a collection (or a builder) of that class
 *   {scalar}        a php scalar (`int`, `string`, `bool`, `float`, `array`)
 *
 * and `null` is "not provable from here".
 */

const {stripNonCode} = require('./phpScanner')

const nameStart = '[A-Za-z_\\x80-\\xff]'
const namePart = '[A-Za-z0-9_\\x80-\\xff]'

// a variable, a qualified name (`App\Models\Order`) or one symbol; whitespace
// is not a token at all, and `=>` is one symbol so a closure's arrow never
// reads as an assignment
// the groups are numbered rather than named: a named group allocates a
// properties object for every match, and a big snippet has thousands of them
const tokenPattern = new RegExp(
  `\\$(${nameStart}${namePart}*)` +
  `|(\\\\?${nameStart}${namePart}*(?:\\\\${nameStart}${namePart}*)*)` +
  '|(\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)' +
  '|(->|\\?->|::|=>|[^\\s])',
  'g',
)

// the words php puts in front of a `(`, where the parentheses hold a
// condition, a parameter list or a cast rather than a value
const conditions = new Set([
  'if', 'elseif', 'while', 'for', 'foreach', 'switch', 'match', 'catch',
  'isset', 'empty', 'unset', 'array', 'list', 'declare',
])

// names that are php's own words rather than a function being called
const words = new Set([
  ...conditions,
  'abstract', 'and', 'as', 'break', 'callable', 'case', 'class', 'clone',
  'const', 'continue', 'default', 'do', 'echo', 'else', 'endif', 'endforeach',
  'endfor', 'endwhile', 'endswitch', 'enum', 'extends', 'final', 'finally',
  'fn', 'function', 'global', 'goto', 'implements', 'include', 'include_once',
  'instanceof', 'interface', 'namespace', 'never', 'new', 'or', 'parent',
  'print', 'private', 'protected', 'public', 'readonly', 'require',
  'require_once', 'return', 'self', 'static', 'throw', 'trait', 'try', 'use',
  'var', 'xor', 'yield',
])

// `(int) $x` turns whatever follows into that scalar
const casts = new Set(['int', 'integer', 'float', 'double', 'real', 'string', 'bool', 'boolean', 'array', 'object', 'mixed', 'binary'])

const scalarOf = word => {
  if (word === 'integer') {
    return 'int'
  }

  if (word === 'boolean') {
    return 'bool'
  }

  if (word === 'double' || word === 'real') {
    return 'float'
  }

  return word
}

/**
 * A resolver's answer as one of the three shapes above.
 *
 * @param {*} found
 * @return {Object|null}
 */
const asType = found => {
  if (!found) {
    return null
  }

  if (typeof found === 'string') {
    return found ? {name: found.replace(/^\\+/, '')} : null
  }

  if (typeof found !== 'object') {
    return null
  }

  if (found.scalar) {
    return {scalar: found.scalar}
  }

  if (found.name) {
    return found.item ? {name: found.name, item: found.item} : {name: found.name}
  }

  return null
}

const call = (resolver, key, ...args) => {
  const fn = resolver ? resolver[key] : null

  if (typeof fn !== 'function') {
    return null
  }

  try {
    return fn.apply(resolver, args)
  } catch {
    return null
  }
}

/**
 * The class a written name stands for, resolved by the caller (its `use`
 * statements, the project's namespaces) and never guessed here.
 *
 * @return {Object|null} a `{name}` type
 */
const resolve = (resolver, written, code) => {
  const found = call(resolver, 'resolveName', written, code)

  if (typeof found === 'string') {
    const trimmed = found.replace(/^\\+/, '')

    return trimmed ? {name: trimmed} : null
  }

  return asType(found)
}

/**
 * Every token of the code before the caret, with the offset it starts at.
 *
 * @param {String} source
 * @return {Array<{type: String, text: String, start: Number}>}
 */
const tokensFor = source => {
  const list = []

  if (typeof source !== 'string' || !source) {
    return list
  }

  const stripped = stripNonCode(source)

  tokenPattern.lastIndex = 0

  let match

  while ((match = tokenPattern.exec(stripped))) {
    list.push({
      type: match[1] ? 'var' : (match[2] ? 'name' : (match[3] ? 'number' : 'symbol')),
      text: match[0],
      start: match.index,
    })
  }

  return list
}

const endOfQuote = (source, start) => {
  const quote = source[start]
  let i = start + 1

  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }

    if (source[i] === quote) {
      return i + 1
    }

    i++
  }

  return source.length
}

const heredocHeader = /<<<[ \t]*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/

const endOfHeredoc = (source, start) => {
  const header = heredocHeader.exec(source.slice(start))

  if (!header) {
    return start + 3
  }

  const label = header[1] || header[2] || header[3]
  const body = source.indexOf('\n', start + header[0].length)

  if (body === -1) {
    return source.length
  }

  const closing = new RegExp(`^[ \\t]*${label}(?![A-Za-z0-9_])`, 'm').exec(source.slice(body + 1))

  if (!closing) {
    return source.length
  }

  return body + 1 + closing.index + closing[0].length
}

/**
 * The comments of the source, by where each one starts.
 *
 * A snippet writes a type down in exactly one place besides an assignment: a
 * `@var` tag. Those tags live in comments, and an `@var` inside a string, a
 * heredoc or a `//` line is text someone is printing, not a type — so the
 * strings and heredocs are stepped over rather than searched through.
 *
 * @param {String} source
 * @return {Array<{start: Number, body: String}>}
 */
const commentsOf = source => {
  const found = []

  if (typeof source !== 'string') {
    return found
  }

  let i = 0

  while (i < source.length) {
    const char = source[i]

    if (char === "'" || char === '"' || char === '`') {
      i = endOfQuote(source, i)
      continue
    }

    if (source.startsWith('<<<', i)) {
      i = endOfHeredoc(source, i)
      continue
    }

    if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      const end = close === -1 ? source.length : close + 2

      found.push({start: i, body: source.slice(i + 2, close === -1 ? source.length : close)})
      i = end
      continue
    }

    // `#[` opens an attribute, only a bare `#` comments the rest of the line
    if ((char === '/' && source[i + 1] === '/') || (char === '#' && source[i + 1] !== '[')) {
      const linebreak = source.indexOf('\n', i)
      const end = linebreak === -1 ? source.length : linebreak

      found.push({start: i, body: source.slice(i, end)})
      i = end
      continue
    }

    i++
  }

  return found
}

// `@var Order $order`, `@var Order[] $orders`, `@var Collection<Order> $o`
const varTag = /@var\s+(\??[\\A-Za-z_][\\A-Za-z0-9_\\]*(?:<[^>\n]*>)?(?:\[\])*)\s+\$([A-Za-z_][A-Za-z0-9_]*)/g

/**
 * The variables a `@var` tag before the caret names a type for.
 *
 * @param {String} code
 * @param {Number} offset
 * @param {Object} resolver
 * @return {Array<Array>} `[name, type]` pairs
 */
const varTags = (code, offset, resolver) => {
  const found = []

  if (typeof code !== 'string' || !code.includes('@var')) {
    return found
  }

  for (const comment of commentsOf(code)) {
    if (comment.start >= offset) {
      break
    }

    let tag

    varTag.lastIndex = 0

    while ((tag = varTag.exec(comment.body))) {
      // a generic or an array of one only says what its outermost class is,
      // and a union says nothing at all
      const written = tag[1].replace(/^[?\\]+/, '').replace(/[<[].*$/, '')

      found.push([tag[2], resolve(resolver, written, code)])
    }
  }

  return found
}

/**
 * The index of the token that closes the bracket opened at `open`, or `-1`
 * when the snippet stops first.
 */
const closingOf = (tokens, open, left, right, limit) => {
  let depth = 0

  for (let i = open; i < limit; i++) {
    if (tokens[i].text === left) {
      depth++
      continue
    }

    if (tokens[i].text === right) {
      depth--

      if (depth === 0) {
        return i
      }
    }
  }

  return -1
}

const scan = (code, offset, resolver) => {
  const locals = new Map()

  for (const [name, type] of varTags(code, offset, resolver)) {
    locals.set(name, type)
  }

  const tokens = tokensFor(code.slice(0, offset))
  const limit = tokens.length

  // the value of the chain being built, what it is being assigned to, and the
  // cast that is waiting for a value to apply to
  let value = null
  let assignTo = null
  let castName = null

  // parentheses and brackets still open: each remembers the value outside it,
  // because `(new Order)->` gives the group a value of its own
  const frames = []

  let paramsPending = false

  // a caret in the middle of a name means that name is still being typed, so
  // the expression is still its receiver and that is what the popup lists
  const typingName = /[A-Za-z0-9_$\\]/.test(code[offset] || '')

  const at = index => (index >= 0 && index < limit ? tokens[index] : null)
  const frame = () => frames[frames.length - 1] || null

  // a cast wraps the whole expression it is written in front of, so it is
  // applied where that expression ends rather than on the first name read
  let concatenated = false

  // `.` always yields a string, whatever its operands are worth, so an unknown
  // operand does not erase it
  const typed = found => (concatenated ? {scalar: 'string'} : found)

  const finish = found => {
    if (!castName) {
      return found
    }

    const cast = {scalar: castName}

    castName = null

    return cast
  }

  for (let i = 0; i < limit; i++) {
    const token = tokens[i]
    const text = token.text
    const lower = token.type === 'name' ? text.toLowerCase() : ''

    // `->`, `?->`: the value becomes the property, or what the method returns
    if (text === '->' || text === '?->') {
      const member = at(i + 1)

      // the caret sits right here: the expression ending at it is the receiver,
      // which is exactly what the popup wants the members of
      if (!member) {
        break
      }

      if (typingName && member.start + member.text.length >= offset) {
        break
      }

      if (member.type !== 'name') {
        value = null
        continue
      }

      i += 1

      if (at(i + 1) && at(i + 1).text === '(') {
        const close = closingOf(tokens, i + 1, '(', ')', limit)

        if (close === -1) {
          frames.push({value, kind: 'call'})
          value = null
          i += 1
          continue
        }

        value = typed(asType(call(resolver, 'returnOf', value, member.text, {static: false})))
        i = close
        continue
      }

      value = typed(asType(call(resolver, 'propertyType', value, member.text)))
      continue
    }

    // `::`: a static call, a static property, a constant or `::class`
    if (text === '::') {
      const member = at(i + 1)

      if (!member) {
        break
      }

      if (typingName && member.start + member.text.length >= offset) {
        break
      }

      if (member.type !== 'name') {
        value = null
        continue
      }

      i += 1

      if (member.text.toLowerCase() === 'class') {
        value = typed({scalar: 'string'})
        continue
      }

      if (at(i + 1) && at(i + 1).text === '(') {
        const close = closingOf(tokens, i + 1, '(', ')', limit)

        if (close === -1) {
          frames.push({value, kind: 'call'})
          value = null
          i += 1
          continue
        }

        value = typed(asType(call(resolver, 'returnOf', value, member.text, {static: true})))
        i = close
        continue
      }

      value = typed(asType(call(resolver, 'propertyType', value, member.text)))
      continue
    }

    if (text === '(') {
      const previous = i > 0 ? tokens[i - 1] : null
      const before = previous && previous.type === 'name' ? previous.text.toLowerCase() : ''
      const inside = at(i + 1)
      const after = at(i + 2)

      let kind = 'group'
      let cast = null

      if (paramsPending) {
        kind = 'params'
        paramsPending = false
      } else if (conditions.has(before)) {
        kind = before
      } else if (inside && inside.type === 'name' && casts.has(inside.text.toLowerCase()) && after && after.text === ')') {
        kind = 'cast'
        cast = scalarOf(inside.text.toLowerCase())
      }

      frames.push({value, kind, cast, item: null, as: false, names: []})
      value = null
      castName = null
      continue
    }

    if (text === ')') {
      const open = frames.pop()

      if (!open) {
        value = null
        continue
      }

      if (open.kind === 'group') {
        // a parenthesised expression is worth what it holds
        value = typed(value)
        continue
      }

      if (open.kind === 'cast') {
        castName = open.cast
      }

      value = null
      continue
    }

    if (text === '[') {
      const close = closingOf(tokens, i, '[', ']', limit)

      if (close === -1) {
        frames.push({value: null, kind: 'index'})
        value = null
        continue
      }

      // `$orders[0]` is one order, a collection's item
      value = value && value.item ? typed({name: value.item}) : null
      i = close
      continue
    }

    if (text === ']') {
      frames.pop()
      value = null
      continue
    }

    if (text === '{' || text === '}') {
      // a block is not part of an expression, and what is inside it is read
      // from the start of the block
      value = null
      continue
    }

    if (text === ';') {
      if (assignTo) {
        locals.set(assignTo, finish(value))
      }

      castName = null
      concatenated = false
      assignTo = null
      value = null
      continue
    }

    if (text === '=' || text === '=>') {
      // the right hand side starts here; `=>` is a key and holds no value
      value = null
      continue
    }

    if (text === ',') {
      const open = frame()

      // the next parameter of a closure declares its own type
      if (open) {
        open.names = []
      }

      continue
    }

    if (token.type === 'var') {
      const name = text.slice(1)
      const open = frame()
      const next = at(i + 1)

      // `foreach ($orders as $order)` takes the item of what it walks, and
      // `as $key => $value` names the key and the value separately
      if (open && open.as) {
        open.as = false

        if (next && next.text === '=>') {
          locals.set(name, null)
          open.as = true
        } else {
          locals.set(name, open.item)
        }

        value = null
        continue
      }

      // `catch (RuntimeException $e)` and `function (Order $order)` declare
      // their variable with a type in front of it
      if (open && (open.kind === 'catch' || open.kind === 'params')) {
        locals.set(name, open.names.length === 1 ? resolve(resolver, open.names[0], code) : null)
        open.names = []
        value = null
        continue
      }

      if (next && next.text === '=') {
        assignTo = name
        value = null
        continue
      }

      if (next && next.text === '(') {
        const close = closingOf(tokens, i + 1, '(', ')', limit)

        if (close === -1) {
          frames.push({value, kind: 'call'})
          value = null
          i += 1
          continue
        }

        // a variable holding a closure: nothing is known about what it returns
        value = null
        i = close
        continue
      }

      value = typed(locals.get(name) || null)
      continue
    }

    if (token.type === 'name') {
      const next = at(i + 1)

      if (lower === 'new') {
        const target = at(i + 1)

        if (!target) {
          break
        }

        if (target.type !== 'name') {
          value = null
          continue
        }

        i += 1
        value = typed(resolve(resolver, target.text, code))

        if (at(i + 1) && at(i + 1).text === '(') {
          const close = closingOf(tokens, i + 1, '(', ')', limit)

          if (close === -1) {
            frames.push({value, kind: 'call'})
            value = null
            i += 1
            continue
          }

          i = close
        }

        continue
      }

      if (lower === 'function' || lower === 'fn') {
        // the parameter list is where a closure writes its types down
        paramsPending = true
        value = null
        continue
      }

      if (lower === 'as') {
        const open = frame()

        if (open) {
          open.as = true
          open.item = value && value.item ? {name: value.item} : null
        }

        value = null
        continue
      }

      const open = frame()

      if (open && (open.kind === 'catch' || open.kind === 'params')) {
        open.names.push(text)
        continue
      }

      if (paramsPending) {
        if (next && next.text === '(') {
          // the name of a declared function, whose `(` is its parameters
          continue
        }

        paramsPending = false
      }

      if (next && next.text === '::') {
        value = typed(resolve(resolver, text, code))
        continue
      }

      if (next && next.text === '(') {
        if (words.has(lower)) {
          // `if (`, `foreach (`: the parenthesis decides what it holds
          value = null
          continue
        }

        const close = closingOf(tokens, i + 1, '(', ')', limit)

        if (close === -1) {
          frames.push({value, kind: 'call'})
          value = null
          i += 1
          continue
        }

        value = typed(asType(call(resolver, 'functionReturn', text)))
        i = close
        continue
      }

      // a bare name is a type declaration, a constant or a keyword: no value
      value = null
      continue
    }

    if (token.type === 'number') {
      // `1.5` and `1e3` are one token, so a decimal stays a float
      value = typed({scalar: /[.eE]/.test(text) ? 'float' : 'int'})
      continue
    }

    if (text === '.') {
      // concatenation always yields a string
      concatenated = true
      value = {scalar: 'string'}
      continue
    }
  }

  // the statement the caret is in has no `;` yet, and its variable is a local
  // all the same
  if (assignTo && value) {
    locals.set(assignTo, finish(value))
  }

  return {locals, value: finish(value)}
}

/**
 * The type of the expression that ends at the caret.
 *
 * A snippet ending in `->` or `?->` asks about the receiver: `$user->` answers
 * `App\Models\User`. Anything the resolver cannot type is `null`.
 *
 * @param {String} code the snippet
 * @param {Number} offset where the caret is
 * @param {Object} resolver `{resolveName, returnOf, propertyType, functionReturn}`
 * @return {Object|null} `{name}`, `{name, item}`, `{scalar}` or `null`
 */
const typeAt = (code, offset, resolver) => {
  if (typeof code !== 'string' || !code) {
    return null
  }

  const caret = typeof offset === 'number' && offset >= 0 ? Math.min(offset, code.length) : code.length

  try {
    return scan(code, caret, resolver).value
  } catch {
    // a popup is never worth an exception: unknown is an answer
    return null
  }
}

/**
 * The variables the snippet declares before the caret, with what they hold.
 *
 * `name` is written without its `$`, because that is what an editor inserts
 * after typing one. A variable whose type cannot be proven is still a variable,
 * and comes back with a `null` type.
 *
 * @param {String} code the snippet
 * @param {Number} offset where the caret is
 * @param {Object} resolver see `typeAt`
 * @return {Array<{name: String, type: Object|null}>}
 */
const localsAt = (code, offset, resolver) => {
  if (typeof code !== 'string' || !code) {
    return []
  }

  const caret = typeof offset === 'number' && offset >= 0 ? Math.min(offset, code.length) : code.length

  try {
    return Array.from(scan(code, caret, resolver).locals, ([name, type]) => ({name, type}))
  } catch {
    return []
  }
}

module.exports = {
  tokensFor,
  typeAt,
  localsAt,
}
