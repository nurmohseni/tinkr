const {
  stripNonCode,
  importedClasses,
  matchingIn,
  strings,
  functions,
  constants,
  resolveClass,
  shortName,
  returnOf,
  propertyType,
  functionReturn,
  stringContextAt,
  typeAt,
  localsAt,
  memberRanks,
} = require('tinkr-core')

const {getEditorConnection} = require('./processes')
const {readyIndex} = require('./services/project')
const {readyIntel, prefetchIntel, readyMembers, membersFor} = require('./services/intel')

/**
 * What the editor's suggestion popup shows, answered from what has been read of
 * the project rather than from the project itself.
 *
 * Every keystroke asks this, so nothing here runs php, opens a session or calls
 * an API. The intel read (see services/intel) has already booted the app and
 * written down what it holds: the models and their columns, the classes and their
 * members, the facades and their managers, the config keys, routes, views, env
 * names, translation keys and bindings, the functions and the constants.
 * The project index answers for class names, exactly as it did before. A question
 * the read cannot answer — a class it did not carry — is read once behind the
 * keystroke, and that read is waited on for as long as a popup may wait: the first
 * name typed into a window that was just opened is asked while the project is still
 * being read, and it is owed members rather than "No suggestions.".
 *
 * The order is the order the snippet is written in: a string argument that holds
 * a name, a `::` on a class, a `->` on a value whose type the snippet established,
 * a `$` variable, and a name on its own. Each answers from what has been read, and
 * a miss is never a guess: a list answered before its read was done says so, and
 * the editor asks again on the next keystroke.
 */

// what php lets a class, a method and a namespace segment be called
const nameStart = '[A-Za-z_\\x80-\\xff]'
const namePart = '[A-Za-z0-9_\\x80-\\xff]'
const segment = `${nameStart}${namePart}*`
const qualified = `\\\\?${segment}(?:\\\\${segment})*`

// `Teatro::whe`, and `App\Models\Teatro::` before it: the class a member is asked
// of, and what has been typed of the member
const staticAccess = new RegExp(`(${qualified})::(${segment})?$`)

// `$x->whe`, `$x?->whe`: what has been typed of the member
const memberAccess = new RegExp(`(?:->|\\?->)(${segment})?$`)

// `$us`: the variable being typed, without the `$`
const variableAccess = new RegExp(`\\$(${segment})?$`)

// the name being typed, a namespace separator included: `App\Models\Tea` is what
// the completion of `App\Models\` and of `Tea` both start from
const partialName = new RegExp(`(${qualified}\\\\?)$`)

// how many names a popup holds: one letter of a vendor directory is thousands
const nameLimit = 40
// how many members, values or calls one popup holds
const itemLimit = 200

// how many names of each kind a bare-name popup holds: a function list is not
// what someone typing `$` is looking at, and the class names come first
const functionLimit = 40
const constantLimit = 30
const keywordLimit = 30

/**
 * How long a popup waits for a read it needs.
 *
 * The first name typed into a window that was just opened is asked before the
 * project has finished being read, and that read is a php process on the machine a
 * connection runs on: a project the app has read before is done in tens of
 * milliseconds, and a second and a half covers a cold one without turning a
 * keystroke into a pause. A read that has not answered by then is not waited on —
 * the popup answers what it has, marked incomplete, and the next keystroke asks
 * again (see services/intel for the read itself).
 */
const asking = 1500

/**
 * A read's answer, when it arrives within the wait a popup is allowed.
 *
 * The read is attended to whatever the wait is: one that lands after the popup
 * answered is dropped, and one that fails is not a popup that fails.
 *
 * @param {Promise<any>} read
 * @param {Number} wait milliseconds, and no time left is no wait at all
 * @return {Promise<{value: any}|null>} null when the read did not land in time
 */
const within = (read, wait) =>
  new Promise(resolve => {
    let timer = null
    const settle = answer => {
      clearTimeout(timer)
      resolve(answer)
    }

    Promise.resolve(read).then(value => settle({value}), () => settle({value: null}))

    // a wait that is already spent is answered at once: the caller waits once for
    // the whole popup, and the second read it needs does not get a wait of its own
    if (wait <= 0) {
      resolve(null)

      return
    }

    timer = setTimeout(() => resolve(null), wait)

    // a popup that is gone is not a reason for the process to stay awake
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  })

/**
 * The project's read, for a popup that is allowed to wait for it.
 *
 * A window that was just opened has that read in flight, and the first name typed
 * into it is owed an answer rather than "No suggestions.". Nothing new is started
 * here: the read is the one the connection shares, and only a project that has
 * never been read starts one (see prefetchIntel).
 *
 * @param {Object} connection
 * @param {Number} wait milliseconds the popup may wait
 * @return {Promise<{intel: Object|null, reading: Boolean}>} `reading` is true when
 * the read that would answer was still going
 */
const intelAt = async (connection, wait) => {
  const held = readyIntel(connection)

  if (held) {
    return {intel: held, reading: false}
  }

  const read = prefetchIntel(connection)

  if (!read) {
    return {intel: null, reading: false}
  }

  const answer = await within(read, wait)

  return {intel: readyIntel(connection), reading: answer === null}
}

/**
 * A popup's answer, and whether it was answered from less than the whole read: an
 * incomplete list is one the editor asks again for on the next keystroke.
 *
 * @param {Array<Object>} items
 * @param {Boolean} incomplete
 * @return {{items: Array<Object>, incomplete?: Boolean}}
 */
const answering = (items, incomplete) => (incomplete ? {items, incomplete: true} : {items})

/**
 * The php keywords a snippet can be written with.
 *
 * They are the one list that needs nothing read: they are the language, and a
 * name typed where a statement goes is as likely a keyword as a class.
 */
const keywords = [
  'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class',
  'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo', 'else',
  'elseif', 'empty', 'enum', 'extends', 'final', 'finally', 'fn', 'for',
  'foreach', 'function', 'global', 'if', 'implements', 'include', 'include_once',
  'instanceof', 'insteadof', 'interface', 'isset', 'list', 'match', 'namespace',
  'new', 'or', 'print', 'private', 'protected', 'public', 'readonly', 'require',
  'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset',
  'use', 'var', 'while', 'xor', 'yield', 'true', 'false', 'null', 'self', 'parent',
]

/**
 * @param {String} connectionId
 * @param {{code: String, offset: Number, triggerCharacter: String}} request
 * what the editor holds before the cursor
 * @return {Promise<{items: Array<Object>, incomplete?: Boolean}>} never rejects: a
 * suggestion is not worth an error where the typing goes
 */
const phpCompletions = async (connectionId, request = {}) => {
  const {code = '', offset = 0} = request
  const connection = getEditorConnection(connectionId)

  if (!connection) {
    return {items: []}
  }

  try {
    // the reads the answer needs are waited on for as long as a popup may wait,
    // and no longer: what is not there by then is marked, not guessed at
    const until = Date.now() + asking
    const {intel, reading} = await intelAt(connection, asking)

    const context = stringContextAt(code, offset)

    if (context) {
      return answering(stringItems(intel, context, offset), reading)
    }

    // the code before the cursor is all a `::`, a `->` or a `$` is about, and it
    // is what holds the snippet's own `use` statements
    const before = stripNonCode(code.slice(0, offset))
    const access = staticAccess.exec(before)

    if (access) {
      const written = resolveWritten(intel, before, access[1], connection)
      const typed = access[2] || ''

      if (!written) {
        return answering([], reading)
      }

      const {members, incomplete} = await membersAt(connection, intel, {name: written}, {static: true}, until - Date.now())

      return answering(memberItems(typed, members, {intel, owner: written, static: true}), reading || incomplete)
    }

    const member = memberAccess.exec(before)

    if (member) {
      const typed = member[1] || ''
      const type = typeAt(code, offset - typed.length, resolverFor(connection, intel))

      if (!type || !type.name) {
        return answering([], reading)
      }

      const asked = {static: false, item: type.item}
      const {members, incomplete} = await membersAt(connection, intel, type, asked, until - Date.now())

      return answering(memberItems(typed, members, {intel, owner: type.name, static: false}), reading || incomplete)
    }

    const variable = variableAccess.exec(before)

    if (variable) {
      const typed = variable[1] || ''

      return answering(localItems(connection, intel, code, offset - typed.length, typed), reading)
    }

    return answering(bareItems(connection, intel, before), reading)
  } catch (e) {
    return {items: []}
  }
}

/**
 * The class a name written before a `::` stands for.
 *
 * A `use` statement answers for a short name, and it is the name the run will
 * call too; the read answers for the project's own models and for the short
 * names the framework's classes are written with. What is left is a class of the
 * project that is not a model — a service, a support object, a form request — and
 * the class index is where the project's own names are: the name the popup offers
 * when it is typed on its own is the name a `::` can be written after.
 *
 * @param {Object|null} intel
 * @param {String} before the code before the cursor, stripped
 * @param {String} written the class name as it is written
 * @param {Object} connection
 * @return {String|null} the fully qualified name, or null when the name does not
 * say which class it is
 */
const resolveWritten = (intel, before, written, connection) => {
  if (!written.includes('\\')) {
    const imported = importedClasses(before).get(written.toLowerCase())

    if (imported) {
      return imported
    }
  }

  return resolveClass(intel, written) || (written.includes('\\') ? null : indexClass(connection, written))
}

/**
 * The class a short name names in the project's class index.
 *
 * One class behind the name is that class. A name several classes share is the
 * project's own when exactly one of them is, and nothing otherwise: a popup that
 * picks one of two is worse than one that waits for a `use` line to say which.
 *
 * @param {Object} connection
 * @param {String} written
 * @return {String|null}
 */
const indexClass = (connection, written) => {
  const found = readyIndex(connection)
  const candidates = found && found.index.get(String(written).toLowerCase())

  if (!candidates || candidates.size === 0) {
    return null
  }

  if (candidates.size === 1) {
    return candidates.values().next().value
  }

  const own = found.own || []
  const mine = Array.from(candidates).filter(name => own.some(root => name.toLowerCase().startsWith(root)))

  return mine.length === 1 ? mine[0] : null
}

/**
 * The members of a type, from what the read already holds.
 *
 * Nothing waits here: a class the read did not carry — the framework's Carbon, a
 * package's response class — is read behind the keystroke, one class at a time, so
 * the next keystroke has it. This is what the type inference asks hop by hop, and
 * a chain ten members long is not ten pauses.
 *
 * @param {Object} connection
 * @param {Object} type `{name, item?}`
 * @param {{static: Boolean, item?: String|null}} options
 * @return {Array<Object>}
 */
const membersNow = (connection, type, options) => {
  const asked = {static: options.static === true, item: options.item || null}
  const members = readyMembers(connection, type.name, asked)

  if (members.length === 0) {
    // an empty answer for a name the read knows nothing about is the answer until
    // the class is read; a name it could not read at all is remembered as such
    membersFor(connection, type.name, asked).catch(() => {})
  }

  return members
}

/**
 * The members of a type, for a popup that may wait for the read of a class the
 * project's read did not carry.
 *
 * The first `Order::` of a window is the one that reads the class, and it is owed
 * the members rather than an empty list: the read is shared with whatever else asks
 * for the same class, and waited on for as long as the popup may wait. A read still
 * going when that wait ends leaves the list incomplete, and the editor asks again
 * on the next keystroke.
 *
 * @param {Object} connection
 * @param {Object|null} intel
 * @param {Object} type `{name, item?}`
 * @param {{static: Boolean, item?: String|null}} options
 * @param {Number} wait milliseconds
 * @return {Promise<{members: Array<Object>, incomplete: Boolean}>}
 */
const membersAt = async (connection, intel, type, options, wait) => {
  if (!intel || !type || !type.name) {
    return {members: [], incomplete: false}
  }

  const asked = {static: options.static === true, item: options.item || null}
  const held = readyMembers(connection, type.name, asked)

  if (held.length) {
    return {members: held, incomplete: false}
  }

  const answer = await within(membersFor(connection, type.name, asked), wait)

  if (answer === null) {
    return {members: held, incomplete: true}
  }

  return {members: (answer.value || []).length ? answer.value : held, incomplete: false}
}

/**
 * The resolver the type inference asks: what a written name is, what a member
 * returns, what a property holds, what a function answers.
 *
 * It is built per request and memoizes what it looks up, so a chain with ten hops
 * over two classes asks for those two classes' members once.
 *
 * @param {Object} connection
 * @param {Object|null} intel
 * @return {Object}
 */
const resolverFor = (connection, intel) => {
  const cache = new Map()

  const membersOfType = (type, options) => {
    if (!type || !type.name) {
      return []
    }

    const key = `${type.name.toLowerCase()}|${(type.item || '').toLowerCase()}|${options.static === true ? '1' : '0'}`

    if (!cache.has(key)) {
      cache.set(key, membersNow(connection, type, options))
    }

    return cache.get(key)
  }

  return {
    resolveName: (written, code) => resolveWritten(intel, stripNonCode(String(code == null ? '' : code)), written, connection),
    returnOf: (type, name, options = {}) => {
      const members = membersOfType(type, {static: options.static === true, item: type.item})
      const wanted = String(name == null ? '' : name).toLowerCase()
      const member = members.find(entry => entry.name.toLowerCase() === wanted)

      return member ? returnOf(intel, type, member) : null
    },
    propertyType: (type, name) => {
      if (!type || !type.name) {
        return null
      }

      // the read's own property answer already asks for the members, and it walks
      // the same list this resolver does: both are in memory
      return propertyType(intel, type, name)
    },
    functionReturn: name => functionReturn(intel, name),
  }
}

/**
 * The names of a string argument: a config key, a route, a view, an env name, a
 * translation key, a container binding.
 *
 * The answer replaces what has been typed since the quote, because a key holds
 * dots and separators that monaco's word boundaries do not: that is the range the
 * row carries.
 *
 * @param {Object|null} intel
 * @param {{kind: String, prefix: String, start: Number}} context
 * @param {Number} offset the caret
 * @return {Array<Object>}
 */
const stringItems = (intel, context, offset) => {
  const typed = context.prefix.toLowerCase()
  const seen = new Set()
  const items = []

  // the read's list is grouped by the name itself, which is the order a key list
  // is read in; a prefix narrows it and the cap then keeps the first of it
  for (const entry of strings(intel, context.kind)) {
    const value = entry && entry.value

    if (!value || seen.has(value)) {
      continue
    }

    if (typed && !value.toLowerCase().startsWith(typed)) {
      continue
    }

    seen.add(value)
    items.push({
      type: 'value',
      label: value,
      detail: entry.detail || '',
      filter: value,
      insert: value,
      sort: '0',
      from: context.start,
      to: offset,
    })

    if (items.length >= itemLimit) {
      break
    }
  }

  return items
}

// how the kinds of member rank inside their group: `$user->` is a column far more
// often than it is `save()`, and a relation is the next thing a model is asked for
const kindRank = {attribute: '0', relation: '1', scope: '2', property: '3', method: '4', constant: '5'}

/**
 * Where a member sits among its own kind: the tier the ranking gave it — the
 * names people write most, the class's own, the facade's object, the rest, the
 * framework's plumbing — and then the order it was read in.
 *
 * @param {Object} member
 * @param {Number} at the member's place in the read
 * @param {Map<Object, String>} ranks the tier of each member of the list
 * @return {String}
 */
const rankOf = (member, at, ranks) => `${(ranks && ranks.get(member)) || '5000'}${String(at).padStart(4, '0')}`

/**
 * The key a row sorts by, the same one the editor's popup uses: its kind, its
 * rank, and the name.
 *
 * @param {Object} item
 * @return {String}
 */
const rowKey = item => `${item.sort === undefined || item.sort === null ? '6' : item.sort}${item.rank || ''}${item.label}`

/**
 * The members of a class or a value, as the popup shows them.
 *
 * What has been typed narrows the whole list before anything is capped, so a name
 * three hundred entries into a class is still reached by typing it, and the cap
 * then keeps the best rows rather than the ones the read happened to list first.
 *
 * @param {String} typed what has been typed of the member
 * @param {Array<Object>} members
 * @param {{intel: Object|null, owner: String, static: Boolean}} [scope] the class the
 * members answer for, which is what they are ranked by
 * @return {Array<Object>}
 */
const memberItems = (typed, members, scope = {}) => {
  const needle = String(typed || '').toLowerCase()
  const ranks = memberRanks(members, scope)
  const items = []

  for (const [at, member] of members.entries()) {
    if (!member || !member.name) {
      continue
    }

    if (needle && !member.name.toLowerCase().startsWith(needle)) {
      continue
    }

    items.push(memberItem(member, rankOf(member, at, ranks)))
  }

  items.sort((one, other) => (rowKey(one) < rowKey(other) ? -1 : (rowKey(one) > rowKey(other) ? 1 : 0)))

  return items.slice(0, itemLimit)
}

/**
 * One member as the popup shows it: the name, the signature it is called with in
 * the detail, the type a column holds, and the call — with the parameters that
 * have to be given as placeholders — as what is inserted.
 *
 * @param {Object} member
 * @param {String} rank where the member sits among its kind
 * @return {Object}
 */
const memberItem = (member, rank) => {
  const params = Array.isArray(member.params) ? member.params : []
  const type = typeLabel(member.returns)
  const required = requiredOf(params)
  const placeholders = required.map((name, at) => `\${${at + 1}:${name}}`).join(', ')
  const item = {
    type: member.kind || 'method',
    label: member.name,
    detail: '',
    filter: member.name,
    insert: member.name,
    // the plumbing is behind every kind, not only behind its own: a model's
    // `incrementing` and `timestamps` are public properties the framework reads,
    // and they would otherwise sit in front of every call the model answers
    sort: String(rank || '').startsWith('9') ? '9' : (kindRank[member.kind] || '6'),
    rank,
  }

  if (member.kind === 'method') {
    item.detail = [signatureOf(member.name, params), type].filter(Boolean).join(': ')

    if (placeholders) {
      item.insert = `${member.name}(${placeholders})`
      item.snippet = true
    } else {
      item.insert = `${member.name}()`
    }
  } else if (member.kind === 'constant') {
    item.detail = 'constant'
    item.insert = member.name
  } else {
    item.detail = type || ''
    item.insert = member.name
  }

  if (member.doc) {
    item.documentation = member.doc
  }

  return item
}

/**
 * The parameters that have to be given, as the names the snippet writes in the
 * placeholders. A parameter with a default is left out of the call a popup
 * inserts, so the caret starts where the argument is.
 *
 * @param {Array<String>} params
 * @return {Array<String>} the names without their `$`
 */
const requiredOf = params => params
  .filter(param => typeof param === 'string' && param.includes('$') && !param.includes('='))
  .map(param => {
    const name = /\$([A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)/.exec(param)

    return name ? name[1] : param.trim()
  })
  .filter(Boolean)

/**
 * A signature the way php writes it, with the parameters the popup inserts
 * already in place.
 *
 * @param {String} name
 * @param {Array<String>} params
 * @return {String}
 */
const signatureOf = (name, params) => `${name}(${params.join(', ')})`

/**
 * A type as a person reads it: a class's short Name, a collection of things as
 * `Collection<Thing>`, and a value with no members as php's own word for it.
 *
 * @param {Object|String|null} type the shared Type
 * @return {String}
 */
const typeLabel = type => {
  if (!type) {
    return ''
  }

  if (typeof type === 'string') {
    return shortName(type)
  }

  if (type.scalar) {
    return type.scalar
  }

  if (!type.name) {
    return ''
  }

  const name = shortName(type.name)

  return type.item ? `${name}<${shortName(type.item)}>` : name
}

/**
 * The snippet's variables, of the type the snippet gave them.
 *
 * The names are matched on what has been typed after the `$`, and inserted
 * without it: the `$` is already in the editor, and a second one is not a name.
 *
 * @param {Object} connection
 * @param {Object|null} intel
 * @param {String} code
 * @param {Number} offset the caret, at the `$`
 * @param {String} typed what has been typed after the `$`
 * @return {Array<Object>}
 */
const localItems = (connection, intel, code, offset, typed) => {
  const needle = String(typed || '').toLowerCase()
  const items = []

  for (const local of localsAt(code, offset, resolverFor(connection, intel))) {
    if (!local || !local.name) {
      continue
    }

    if (needle && !local.name.toLowerCase().startsWith(needle)) {
      continue
    }

    items.push({
      type: 'variable',
      label: `$${local.name}`,
      detail: typeLabel(local.type),
      filter: local.name,
      insert: local.name,
      sort: '1',
    })
  }

  return items.slice(0, itemLimit)
}

/**
 * A name on its own: the project's classes, the functions the read found, the
 * global constants, and the language's own words.
 *
 * @param {Object} connection
 * @param {Object|null} intel
 * @param {String} before the code before the cursor, stripped
 * @return {Array<Object>}
 */
const bareItems = (connection, intel, before) => {
  const match = partialName.exec(before)

  // a popup of every class in the project is not what a caret with nothing before
  // it is asking for
  if (!match) {
    return []
  }

  const typed = match[1]
  const item = []
  const needle = typed.toLowerCase()

  for (const found of matchingIn(readyIndex(connection), typed, nameLimit)) {
    item.push({
      type: 'class',
      label: found.name,
      detail: found.qualified,
      filter: found.name,
      insert: found.name,
      sort: found.own ? '2' : '3',
      import: found.qualified,
    })
  }

  let count = 0

  for (const fn of functions(intel)) {
    if (!fn.name.toLowerCase().startsWith(needle) || fn.name.toLowerCase() === needle) {
      continue
    }

    item.push(frameItem('function', fn.name, fn.params, '3'))

    if (++count >= functionLimit) {
      break
    }
  }

  count = 0

  for (const name of constants(intel)) {
    if (!name.toLowerCase().startsWith(needle) || name.toLowerCase() === needle) {
      continue
    }

    item.push({
      type: 'constant',
      label: name,
      detail: 'constant',
      filter: name,
      insert: name,
      sort: '3',
    })

    if (++count >= constantLimit) {
      break
    }
  }

  count = 0

  for (const keyword of keywords) {
    if (!keyword.startsWith(needle) || keyword === needle) {
      continue
    }

    item.push({
      type: 'keyword',
      label: keyword,
      detail: 'keyword',
      filter: keyword,
      insert: keyword,
      sort: '9',
    })

    if (++count >= keywordLimit) {
      break
    }
  }

  return item
}

/**
 * A function as the popup shows it.
 *
 * @param {String} type
 * @param {String} name
 * @param {Array<String>} params
 * @param {String} sort
 * @return {Object}
 */
const frameItem = (type, name, params, sort) => {
  const required = requiredOf(params)
  const placeholders = required.map((param, at) => `\${${at + 1}:${param}}`).join(', ')

  return {
    type,
    label: name,
    detail: signatureOf(name, params),
    filter: name,
    insert: placeholders ? `${name}(${placeholders})` : `${name}()`,
    snippet: Boolean(placeholders),
    sort,
  }
}

/**
 * The signature of the call the caret is in, for the parameters it takes.
 *
 * It is the same memory the popup is answered from: the class a `::` or a `->`
 * names, the members it was read with, and the parameters of the one method whose
 * bracket is open. Nothing is run and nothing is asked of the project.
 *
 * @param {String} connectionId
 * @param {{code: String, offset: Number}} request
 * @return {Object|null} `{label, parameters, activeParameter}`, or null when the
 * call is not one the read knows
 */
const phpSignature = (connectionId, request = {}) => {
  const {code = '', offset = 0} = request
  const connection = getEditorConnection(connectionId)

  if (!connection || typeof code !== 'string') {
    return null
  }

  try {
    const intel = readyIntel(connection)

    if (!intel) {
      return null
    }

    const found = callAt(code, offset)

    if (!found) {
      return null
    }

    const params = parametersOf(connection, intel, code, found)

    if (!params) {
      return null
    }

    return {
      label: signatureOf(found.name, params),
      parameters: params.map(param => ({label: param})),
      activeParameter: Math.min(found.activeParameter, Math.max(params.length - 1, 0)),
    }
  } catch (e) {
    return null
  }
}

/**
 * The call whose bracket is open at the caret, the name it is called on, and the
 * argument the caret is in.
 *
 * The snippet up to the caret is blanked of strings and comments, so a bracket or
 * a comma inside either is not one the call wrote, and the scan is backwards from
 * the caret to the first bracket that is not closed after it.
 *
 * @param {String} code
 * @param {Number} offset
 * @return {{open: Number, name: String, kind: String, written: String, receiver: Number|null, activeParameter: Number}|null}
 */
const callAt = (code, offset) => {
  const at = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, code.length))
  const text = stripNonCode(code.slice(0, at))
  let depth = 0
  let open = -1

  for (let i = text.length - 1; i >= 0; i--) {
    const char = text[i]

    if (char === ')' || char === ']' || char === '}') {
      depth++
    } else if (char === '(' || char === '[' || char === '{') {
      if (depth === 0) {
        if (char !== '(') {
          return null
        }

        open = i
        break
      }

      depth--
    }
  }

  if (open === -1) {
    return null
  }

  const before = text.slice(0, open)
  const onClass = /([\\A-Za-z_\x80-\xff][\\\w\x80-\xff]*)\s*::\s*([A-Za-z_\x80-\xff][\w\x80-\xff]*)\s*$/.exec(before)
  const onObject = /(?:->|\?->)\s*([A-Za-z_\x80-\xff][\w\x80-\xff]*)\s*$/.exec(before)
  const onFunction = /([\\A-Za-z_\x80-\xff][\\\w\x80-\xff]*)\s*$/.exec(before)
  const call = {open, activeParameter: commasBetween(text.slice(open + 1))}

  if (onClass) {
    return {...call, kind: 'static', written: onClass[1], name: onClass[2], receiver: null}
  }

  if (onObject) {
    const arrow = before.lastIndexOf('->', onObject.index + onObject[0].length)

    return {...call, kind: 'member', written: '', name: onObject[1], receiver: arrow}
  }

  // `$config(` calls whatever the variable holds, not the function of that name
  if (onFunction && before[onFunction.index - 1] !== '$') {
    return {...call, kind: 'function', written: onFunction[1], name: shortName(onFunction[1]), receiver: null}
  }

  return null
}

/**
 * How many arguments have been written since the call's bracket.
 *
 * @param {String} text the blanked arguments
 * @return {Number}
 */
const commasBetween = text => {
  let depth = 0
  let count = 0

  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') {
      depth++
    } else if (char === ')' || char === ']' || char === '}') {
      depth--
    } else if (char === ',' && depth === 0) {
      count++
    }
  }

  return count
}

/**
 * The parameters of the method a call names, or null when the read does not know
 * it: a signature that could be wrong is not drawn.
 *
 * @param {Object} connection
 * @param {Object} intel
 * @param {String} code
 * @param {Object} call what callAt found
 * @return {Array<String>|null}
 */
const parametersOf = (connection, intel, code, call) => {
  if (call.kind === 'function') {
    const found = functions(intel).find(fn => fn.name.toLowerCase() === call.name.toLowerCase())

    return found ? found.params : null
  }

  let type = null

  if (call.kind === 'static') {
    const written = resolveWritten(intel, stripNonCode(code.slice(0, call.open)), call.written, connection)
    type = written ? {name: written} : null
  } else {
    type = typeAt(code, call.receiver, resolverFor(connection, intel))
  }

  if (!type || !type.name) {
    return null
  }

  const members = membersNow(connection, type, {
    static: call.kind === 'static',
    item: type.item || null,
  })
  const wanted = call.name.toLowerCase()
  const member = members.find(entry => entry.name.toLowerCase() === wanted && entry.kind === 'method')

  return member ? member.params : null
}

module.exports = {
  phpCompletions,
  phpSignature,
}
