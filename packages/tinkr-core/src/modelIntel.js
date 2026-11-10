/**
 * A model, as a popup sees it: its columns, the relations that reach other
 * models, and the builder methods it answers statically.
 *
 * All of it comes from the one booted read (see intelScript), so nothing here
 * touches php — this is a translation of an answer into the shapes the editor
 * wants. The types it hands out are the shared `Type`: `{name}` for an object,
 * `{name, item}` for a collection or a builder of models, `{scalar}` for a value
 * php has no members for, and nothing at all when the answer does not say.
 */
/**
 * The framework names this file compares types against. They are written once
 * because a type is often answered as one of them: a builder returns itself, a
 * relation returns a collection of models.
 */
const framework = {
  model: 'Illuminate\\Database\\Eloquent\\Model',
  eloquent: 'Illuminate\\Database\\Eloquent\\Builder',
  query: 'Illuminate\\Database\\Query\\Builder',
  collection: 'Illuminate\\Support\\Collection',
  carbon: 'Illuminate\\Support\\Carbon',
  carbonImmutable: 'Illuminate\\Support\\CarbonImmutable',
  stringable: 'Illuminate\\Support\\Stringable',
}

// a column type, as the database spells it, in the five kinds a value can be:
// everything else — a json column, a blob, a decimal — is a value with no members
// worth offering, which is what `null` already means
const scalarOf = {
  integer: 'int',
  int: 'int',
  bigint: 'int',
  smallint: 'int',
  mediumint: 'int',
  tinyint: 'int',
  int4: 'int',
  int8: 'int',
  serial: 'int',
  bigserial: 'int',
  float: 'float',
  double: 'float',
  real: 'float',
  numeric: 'float',
  // a decimal column comes back as the driver spells it, which is text
  decimal: 'string',
  string: 'string',
  varchar: 'string',
  char: 'string',
  text: 'string',
  tinytext: 'string',
  mediumtext: 'string',
  longtext: 'string',
  uuid: 'string',
  ulid: 'string',
  citext: 'string',
  boolean: 'bool',
  bool: 'bool',
  // not a column type, but the same question: a value php has no members for
  array: 'array',
  iterable: 'array',
  object: 'object',
}

// the column types that Laravel hands back as a Carbon instance: a date is a
// date in a model, whatever the driver calls the column
const dateOf = ['date', 'datetime', 'datetimetz', 'timestamp', 'timestamp without time zone', 'timestamp with time zone', 'timestamptz']

// a cast, as `$casts` writes it, in the same terms
const castOf = {
  int: 'int',
  integer: 'int',
  float: 'float',
  double: 'float',
  real: 'float',
  string: 'string',
  encrypted: 'string',
  hashed: 'string',
  bool: 'bool',
  boolean: 'bool',
  array: 'array',
  json: 'array',
  object: 'object',
  date: 'carbon',
  datetime: 'carbon',
  timestamp: 'carbon',
  immutable_date: 'carbonImmutable',
  immutable_datetime: 'carbonImmutable',
  collection: 'collection',
  // a decimal cast keeps its scale as text: `decimal:2` is a string, and adding to
  // it is the one thing a popup does not offer
  decimal: 'string',
}

/**
 * Where a type ends, in the expression that writes it.
 *
 * A type is written with prose around it and with brackets inside it — `int<0,
 * max>`, `Collection<int, TModel>`, `array{a: int, b: string}` — so the end is
 * the first space that is not inside brackets, and the start is the start.
 *
 * A conditional type — `($id is array ? Collection<int, TModel> : TModel|null)` —
 * answers the case it falls back to: the popup is drawn for a snippet, which
 * passes one id, not a list of them.
 *
 * @param {String|null} text
 * @returns {String} the type expression, or an empty string
 */
const typeExpression = text => {
  const written = String(text == null ? '' : text).trim()

  if (!written) {
    return ''
  }

  if (written[0] === '(') {
    const close = closingIndex(written, 0)
    const inner = written.slice(1, close == null ? undefined : close)
    const question = topLevelIndex(inner, '?')

    if (question !== -1) {
      const colon = topLevelIndex(inner, ':', question)
      const yes = inner.slice(question + 1, colon === -1 ? undefined : colon)
      const no = colon === -1 ? '' : inner.slice(colon + 1)

      return typeExpression(no) || typeExpression(yes)
    }

    return typeExpression(inner)
  }

  let depth = 0

  for (let index = 0; index < written.length; index += 1) {
    const character = written[index]

    if ('<([{'.includes(character)) {
      depth += 1
    } else if ('>)]}'.includes(character)) {
      depth -= 1
    } else if (depth <= 0 && /\s/.test(character)) {
      return written.slice(0, index)
    }
  }

  return written
}

/**
 * The index of the bracket that closes the one at `open`.
 *
 * @param {String} text
 * @param {Number} open
 * @returns {Number|null}
 */
const closingIndex = (text, open) => {
  let depth = 0

  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '(') {
      depth += 1
    } else if (text[index] === ')') {
      depth -= 1

      if (depth === 0) {
        return index
      }
    }
  }

  return null
}

/**
 * The index of the first `character` that is not inside brackets.
 *
 * @param {String} text
 * @param {String} character
 * @param {Number} [from]
 * @returns {Number}
 */
const topLevelIndex = (text, character, from = 0) => {
  let depth = 0

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index]

    if ('<([{'.includes(current)) {
      depth += 1
    } else if ('>)]}'.includes(current)) {
      depth -= 1
    } else if (current === character && depth === 0 && index >= from) {
      return index
    }
  }

  return -1
}

/**
 * A type as written by php or by a docblock, in the editor's terms.
 *
 * The written form is not a type the editor can use: `?Foo`, `Foo|null`,
 * `static`, `$this`, `TModel`, `Collection<int, User>` all mean something only
 * next to the class that says them, so the two things that make a written type
 * concrete are passed in — `self`, the class the type is read on, and `item`, the
 * model a builder or collection is of.
 *
 * @param {String|null} text the type, as written
 * @param {{self?: String, item?: String}} [of] what the type is read on
 * @returns {{name: String}|{name: String, item: String}|{scalar: String}|null}
 */
const typeFrom = (text, of = {}) => {
  const written = typeExpression(text).replace(/^\?/, '')

  if (!written) {
    return null
  }

  // a union is offered by its first member: a popup cannot merge two classes, and
  // `null` is never the interesting half of one
  const member = written.split('|').map(part => part.trim()).find(part => part && part.toLowerCase() !== 'null') || ''

  if (!member) {
    return null
  }

  const generic = /^([^<(]+)<(.+)>$/.exec(member)

  if (generic) {
    const inner = splitGeneric(generic[2])
    const ofInner = inner.length ? typeFrom(inner[inner.length - 1], of) : null
    const base = resolveName(generic[1].trim(), of)

    if (!base) {
      return null
    }

    // `int<0, max>` is an int with a range written on it, not a container
    if (scalarOf[base.toLowerCase()]) {
      return {scalar: scalarOf[base.toLowerCase()]}
    }

    return ofInner && ofInner.name ? {name: base, item: ofInner.name} : {name: base}
  }

  const name = resolveName(member, of)

  if (!name) {
    return null
  }

  const scalar = scalarOf[name.toLowerCase()]

  if (scalar) {
    return {scalar}
  }

  // a name with no namespace is a docblock's shorthand, which the caller resolves
  // against the classes it has: on its own it is not a type the editor can trust
  return name.includes('\\') ? {name} : null
}

/**
 * The name a written type stands for.
 *
 * `self`, `static` and `$this` are the class the member is read on, and a
 * template parameter is whatever the class was made of — which, in a builder, is
 * the model. A name php has no members for — `mixed`, `void`, a callable —
 * answers nothing.
 *
 * @param {String} written
 * @param {{self?: String, item?: String}} of
 * @returns {String|null}
 */
const resolveName = (written, of) => {
  const name = written.replace(/^\\+/, '')

  if (!name) {
    return null
  }

  const lower = name.toLowerCase()

  if (lower === 'self' || lower === 'static' || lower === '$this') {
    return of.self ? of.self.replace(/^\\+/, '') : null
  }

  if (lower === 'parent' || lower === 'mixed' || lower === 'void' || lower === 'never' || lower === 'null') {
    return null
  }

  // a class is generic over its model, and its methods are written in terms of
  // that: `TModel` is the model a builder was made for. A template parameter is a
  // capital T and another capital, which no class is called
  if (/^T[A-Z][A-Za-z0-9]*$/.test(name) && of.item && !name.includes('\\')) {
    return of.item.replace(/^\\+/, '')
  }

  return name
}

/**
 * The arguments of a generic, split at the commas that are not inside one.
 *
 * @param {String} text
 * @returns {Array<String>}
 */
const splitGeneric = text => {
  const parts = []
  let depth = 0
  let start = 0

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '<') {
      depth += 1
    } else if (character === '>') {
      depth -= 1
    } else if (character === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim())
      start = index + 1
    }
  }

  parts.push(text.slice(start).trim())

  return parts.filter(part => part !== '')
}

/**
 * The model's entry in the read, if it is one.
 *
 * @param {Object|null} intel
 * @param {String|null} fqcn
 * @returns {Object|null}
 */
const modelOf = (intel, fqcn) => {
  const name = String(fqcn == null ? '' : fqcn).replace(/^\\+/, '').toLowerCase()

  if (!name || !intel || !Array.isArray(intel.models)) {
    return null
  }

  return intel.models.find(model => String(model.class || '').toLowerCase() === name) || null
}

/**
 * The type of one column: what the model casts it to, or what the database says
 * it is.
 *
 * @param {Object} model
 * @param {Object} attribute
 * @returns {{name: String}|{name: String, item: String}|{scalar: String}|null}
 */
const attributeType = (model, attribute) => {
  const cast = model.casts && attribute && attribute.name ? model.casts[attribute.name] : null
  const fromCast = castType(cast, model)

  if (fromCast) {
    return fromCast
  }

  const kind = String((attribute && attribute.type) || '').toLowerCase().replace(/\(.*$/, '').trim()

  if (!kind) {
    return null
  }

  if (dateOf.includes(kind)) {
    return {name: framework.carbon}
  }

  if (scalarOf[kind]) {
    return {scalar: scalarOf[kind]}
  }

  // `varchar(255)`, `decimal(8,2)`, `timestamp(6)`: the driver's spelling with its
  // size after it, which is not what the type is
  return scalarOf[kind.split(' ')[0]] ? {scalar: scalarOf[kind.split(' ')[0]]} : null
}

/**
 * What a `$casts` entry makes of a value.
 *
 * A cast is written like a call — `decimal:2`, `datetime:Y-m-d`,
 * `AsCollection::class` — so the class or the kind is what comes before the colon.
 *
 * @param {String|undefined} cast
 * @param {Object} model
 * @returns {{name: String}|{name: String, item: String}|{scalar: String}|null}
 */
const castType = (cast, model) => {
  const written = String(cast == null ? '' : cast).trim()

  if (!written) {
    return null
  }

  const kind = written.split(':')[0]
  const known = castOf[kind]

  if (known === 'carbon') {
    return {name: framework.carbon}
  }

  if (known === 'carbonImmutable') {
    return {name: framework.carbonImmutable}
  }

  if (known === 'collection') {
    return {name: framework.collection}
  }

  if (known) {
    return {scalar: known}
  }

  // a cast can name a class — one of the framework's, or the project's own
  const resolved = kind.includes('\\') ? kind : null

  return resolved ? {name: resolved.replace(/^\\+/, '')} : null
}

/**
 * The columns a model has, in the order the table holds them.
 *
 * A column is what a model offers before anything else: `$user->` in a snippet
 * is nearly always a column. A value the model appends — an accessor it
 * serialises — is offered too, with no type, because it is a name on the model
 * all the same.
 *
 * @param {Object|null} intel
 * @param {String} fqcn
 * @returns {Array<{name: String, type: Object|null, nullable: Boolean|null, cast: String|null}>}
 */
const attributesOf = (intel, fqcn) => {
  const model = modelOf(intel, fqcn)

  if (!model) {
    return []
  }

  const attributes = (Array.isArray(model.attributes) ? model.attributes : []).map(attribute => ({
    name: attribute.name,
    type: attributeType(model, attribute),
    nullable: attribute.nullable === true,
    cast: (model.casts && model.casts[attribute.name]) || null,
  }))

  const named = new Set(attributes.map(attribute => attribute.name))

  for (const appended of Array.isArray(model.appends) ? model.appends : []) {
    if (!named.has(appended)) {
      attributes.push({name: appended, type: null, nullable: null, cast: null})
      named.add(appended)
    }
  }

  return attributes
}

/**
 * The relations a model reaches other models through, with the model on the
 * other side: `$user->posts` is a collection of posts, and a popup that knows it
 * offers the next member of the chain.
 *
 * @param {Object|null} intel
 * @param {String} fqcn
 * @returns {Array<{name: String, related: String, many: Boolean, relation: String|null}>}
 */
const relationsOf = (intel, fqcn) => {
  const model = modelOf(intel, fqcn)

  if (!model || !Array.isArray(model.relations)) {
    return []
  }

  return model.relations
    .filter(relation => relation && relation.name && relation.related)
    .map(relation => ({
      name: relation.name,
      related: relation.related,
      many: relation.many === true,
      relation: relation.relation || null,
    }))
}

/**
 * The scopes a model writes: `scopeActive` is called `User::active()`.
 *
 * @param {Object|null} intel
 * @param {String} fqcn
 * @returns {Array<String>}
 */
const scopesOf = (intel, fqcn) => {
  const model = modelOf(intel, fqcn)

  return model && Array.isArray(model.scopes) ? model.scopes.filter(name => typeof name === 'string' && name !== '') : []
}

/**
 * A builder's methods, with the model they were read for bound into them.
 *
 * `Builder::where()` says it returns `$this` and takes `TModel` — read on no
 * model at all, both are empty answers. Read for a model, `$this` is the builder
 * the chain stays on and `TModel` is the model the chain collects: that is what
 * makes `User::where(...)->orderBy(...)->get()` a popup that keeps going.
 *
 * @param {Object|null} intel
 * @param {String} kind 'eloquent' or 'query'
 * @param {String|null} binding the model the builder was made for
 * @returns {Array<Object>} members, as intel members
 */
const builderTable = (intel, kind, binding) => {
  const builders = (intel && intel.builders) || {}
  const methods = Array.isArray(builders[kind]) ? builders[kind] : []
  const self = kind === 'query' ? framework.query : framework.eloquent

  return methods.map(method => {
    const returns = typeFrom(method.returns, {self, item: binding || undefined})
    const bound = returns && returns.name === self && binding && !returns.scalar ? {name: self, item: binding} : returns

    return {
      kind: 'method',
      name: method.name,
      static: false,
      params: Array.isArray(method.params) ? method.params : [],
      returns: bound || null,
      doc: method.doc || undefined,
    }
  })
}

module.exports = {
  framework,
  typeFrom,
  typeExpression,
  resolveName,
  modelOf,
  attributeType,
  castType,
  attributesOf,
  relationsOf,
  scopesOf,
  builderTable,
}
