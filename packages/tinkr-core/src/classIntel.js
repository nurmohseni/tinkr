/**
 * The members of a name, in the terms the popup draws them.
 *
 * One booted read answers most of what a snippet types — the models and their
 * columns, the builders, the facades with the surface of the manager behind them
 * — and this file turns those answers into members. A class the read did not
 * cover can be asked for through `fetch`, which the caller owns: it is the only
 * path here that could ever run php, and it is a function the caller passes or
 * does not.
 *
 * A member is `{kind, name, static, params, returns, doc, declaring, sort}`: what
 * it is, what it is called, how it is called, what it answers, what it says, the
 * class that declares it, and how early it deserves to be in a list that is
 * already filtered to the word being typed.
 */
const {
  framework,
  typeFrom,
  modelOf,
  attributesOf,
  relationsOf,
  scopesOf,
  builderTable,
} = require('./modelIntel')
const {parse} = require('./docblock')

/**
 * A name without the leading separator a docblock writes, for comparing.
 *
 * @param {String|null} value
 * @returns {String}
 */
const clean = value => String(value == null ? '' : value).replace(/^\\+/, '').trim()

/**
 * The same, folded: php names are not case sensitive.
 *
 * @param {String|null} value
 * @returns {String}
 */
const folded = value => clean(value).toLowerCase()

/**
 * The last segment of a name: `User` for `App\Models\User`.
 *
 * @param {String|null} fqcn
 * @returns {String}
 */
const shortName = fqcn => {
  const name = clean(fqcn)
  const at = name.lastIndexOf('\\')

  return at === -1 ? name : name.slice(at + 1)
}

/**
 * Anything derived from one read, computed once for that read.
 *
 * An intel object never changes after it is read, so the indexes over it — the
 * classes by name, the shapes of the project's own namespace — are worth keeping
 * next to it rather than rebuilding them for every keystroke.
 *
 * @param {Object|null} intel
 * @param {String} key
 * @param {Function} build
 * @returns {*}
 */
const derived = new WeakMap()

const memo = (intel, key, build) => {
  if (!intel || typeof intel !== 'object') {
    return build()
  }

  let store = derived.get(intel)

  if (!store) {
    store = new Map()
    derived.set(intel, store)
  }

  if (!store.has(key)) {
    store.set(key, build())
  }

  return store.get(key)
}

/**
 * The classes the read carried, by folded name.
 *
 * @param {Object|null} intel
 * @returns {Map<String, Object>}
 */
const classIndex = intel => {
  return memo(intel, 'classes', () => {
    const index = new Map()
    const classes = (intel && intel.classes) || {}

    for (const name of Object.keys(classes)) {
      const entry = classes[name]

      if (entry && entry.class) {
        index.set(folded(entry.class), entry)
      }
    }

    return index
  })
}

/**
 * One class entry, from the read or from the caller's reader.
 *
 * @param {Object|null} intel
 * @param {String} fqcn
 * @param {Function} [fetch]
 * @returns {Object|null}
 */
const entryOf = (intel, fqcn, fetch) => {
  const name = clean(fqcn)

  if (!name) {
    return null
  }

  const entry = classIndex(intel).get(folded(name))

  if (entry) {
    return entry
  }

  return typeof fetch === 'function' ? fetch(name) || null : null
}

/**
 * A facade's entry in the read: the manager behind it and the docblock that
 * writes out that manager's surface.
 *
 * @param {Object|null} intel
 * @param {String} fqcn
 * @returns {{root: String, doc: String}|null}
 */
const facadeOf = (intel, fqcn) => {
  const facades = (intel && intel.facades) || {}
  const name = clean(fqcn)

  if (!name) {
    return null
  }

  const exact = facades[name]

  if (exact) {
    return exact
  }

  const wanted = folded(name)

  for (const key of Object.keys(facades)) {
    if (folded(key) === wanted) {
      return facades[key]
    }
  }

  return null
}

/**
 * The prefixes the project owns, as the read wrote them.
 *
 * @param {Object|null} intel
 * @returns {Array<String>}
 */
const ownPrefixes = intel => {
  return memo(intel, 'own', () => {
    const own = intel && Array.isArray(intel.own) ? intel.own : []

    return own.filter(prefix => typeof prefix === 'string' && prefix !== '').map(folded)
  })
}

/**
 * Whether a name is the project's own — its models, its services, the classes a
 * snippet is being written against.
 *
 * @param {Object|null} intel
 * @param {String|null} fqcn
 * @returns {Boolean}
 */
const isOwn = (intel, fqcn) => {
  const name = folded(fqcn)

  return name !== '' && ownPrefixes(intel).some(prefix => name.startsWith(prefix))
}

/**
 * Where a member belongs in the list: the model's own columns first, then its
 * scopes, then the project's classes, then the framework's.
 *
 * @param {Object|null} intel
 * @param {String|null} fqcn
 * @returns {String}
 */
const groupOf = (intel, fqcn) => (isOwn(intel, fqcn) ? '2' : '3')

/**
 * The names the read knows, so a short name in a snippet can be settled to the
 * class it means.
 *
 * @param {Object|null} intel
 * @returns {{byFull: Map<String, String>, byShort: Map<String, String>}}
 */
const knownNames = intel => {
  return memo(intel, 'names', () => {
    const byFull = new Map()
    const byShort = new Map()
    const models = intel && Array.isArray(intel.models) ? intel.models : []
    const classes = (intel && intel.classes) || {}
    const facades = (intel && intel.facades) || {}

    const remember = name => {
      const fqcn = clean(name)

      if (!fqcn) {
        return
      }

      byFull.set(folded(fqcn), fqcn)

      const key = folded(shortName(fqcn))
      const existing = byShort.get(key)

      // two classes with one short name: the project's own wins, because that is
      // the one a snippet in this project is about
      if (!existing || (!isOwn(intel, existing) && isOwn(intel, fqcn))) {
        byShort.set(key, fqcn)
      }
    }

    for (const model of models) {
      remember(model && model.class)
    }

    for (const name of Object.keys(classes)) {
      remember(classes[name] && classes[name].class)
    }

    for (const name of Object.keys(facades)) {
      remember(name)
    }

    return {byFull, byShort}
  })
}

/**
 * The class a written name means.
 *
 * A name written with a namespace is taken as written — the snippet said which
 * one it wants. A short name is settled against everything the read knows, and
 * answered with nothing when nothing matches, because a wrong class is worse than
 * no members.
 *
 * @param {Object|null} intel
 * @param {String|null} written
 * @returns {String|null}
 */
const resolveClass = (intel, written) => {
  const name = clean(written)

  if (!name) {
    return null
  }

  const index = knownNames(intel)
  const full = index.byFull.get(folded(name))

  if (full) {
    return full
  }

  if (name.includes('\\')) {
    return name
  }

  // a short name the read did not carry, but every project has: a snippet writes
  // `Str::slug` and means the one class that name has always meant
  return index.byShort.get(folded(name)) || frameworkShortNames[folded(name)] || null
}

/**
 * The short names a snippet writes without importing anything, because the class
 * is the only one by that name in the framework.
 */
const frameworkShortNames = {
  arr: 'Illuminate\\Support\\Arr',
  benchmark: 'Illuminate\\Support\\Benchmark',
  builder: 'Illuminate\\Database\\Eloquent\\Builder',
  carbon: 'Illuminate\\Support\\Carbon',
  collection: 'Illuminate\\Support\\Collection',
  number: 'Illuminate\\Support\\Number',
  str: 'Illuminate\\Support\\Str',
  stringable: 'Illuminate\\Support\\Stringable',
  uri: 'Illuminate\\Support\\Uri',
}

/**
 * Whether the read knows the class at all.
 *
 * @param {Object|null} intel
 * @param {String|null} fqcn
 * @returns {Boolean}
 */
const isKnown = (intel, fqcn) => {
  const name = folded(fqcn)

  if (!name) {
    return false
  }

  const index = knownNames(intel)

  return index.byFull.has(name) || Boolean(facadeOf(intel, fqcn)) || Boolean(frameworkShortNames[name])
}

/**
 * A list of members that does not repeat a name.
 *
 * Later entries of one name are dropped: the class's own declaration, read from
 * reflection, is trusted over a docblock's shorthand.
 *
 * @returns {{list: Array<Object>, add: Function, addAll: Function}}
 */
const collector = () => {
  const list = []
  const seen = new Set()

  const add = member => {
    if (!member || !member.name) {
      return
    }

    const key = member.name.toLowerCase()

    if (seen.has(key)) {
      return
    }

    seen.add(key)
    list.push(member)
  }

  return {
    list,
    add,
    addAll(members) {
      for (const member of members || []) {
        add(member)
      }
    },
  }
}

/**
 * The members a class entry declares, as one list.
 *
 * @param {Object|null} intel
 * @param {String} name
 * @param {{static: Boolean, item?: String, fetch?: Function, budget?: Object}} options
 * @returns {Array<Object>}
 */
const classMembers = (intel, name, options) => {
  const wanted = options.static === true
  const collected = collector()
  const entry = entryOf(intel, name, options.fetch)
  const facade = facadeOf(intel, name)
  const own = groupOf(intel, name)

  if (entry) {
    for (const method of entry.methods || []) {
      if ((method.static === true) !== wanted || !method.name) {
        continue
      }

      collected.add({
        kind: 'method',
        name: method.name,
        static: method.static === true,
        params: Array.isArray(method.params) ? method.params : [],
        returns: typeFrom(method.returns, {self: name, item: options.item}),
        doc: method.doc || undefined,
        // what the class itself declares is what a person writing it is working
        // on, and the popup's ranking asks which class a member came from
        declaring: method.declaring || name,
        sort: groupOf(intel, method.declaring || name),
      })
    }

    if (!wanted) {
      for (const property of entry.properties || []) {
        if (!property.name) {
          continue
        }

        collected.add({
          kind: 'property',
          name: property.name,
          static: false,
          params: [],
          returns: typeFrom(property.type, {self: name}),
          doc: property.doc || undefined,
          declaring: property.declaring || name,
          sort: groupOf(intel, property.declaring || name),
        })
      }
    } else {
      for (const constant of entry.constants || []) {
        if (!constant.name) {
          continue
        }

        collected.add({
          kind: 'constant',
          name: constant.name,
          static: true,
          params: [],
          returns: null,
          declaring: constant.declaring || name,
          sort: groupOf(intel, constant.declaring || name),
        })
      }
    }
  }

  // the docblock is where a class says what it does not declare: the facade's
  // whole manager, a magic property, a scope written as prose
  const doc = parse((entry && entry.doc) || (facade && facade.doc) || '')

  for (const method of doc.methods) {
    if (method.static !== wanted) {
      continue
    }

    collected.add({
      kind: 'method',
      name: method.name,
      static: method.static,
      params: method.params,
      returns: typeFrom(method.returns, {self: name, item: options.item}),
      sort: own,
    })
  }

  if (!wanted) {
    for (const property of doc.properties) {
      collected.add({
        kind: 'property',
        name: property.name,
        static: false,
        params: [],
        returns: typeFrom(property.type, {self: name}),
        sort: own,
      })
    }
  }

  // a facade whose docblock wrote nothing out still answers with the manager's
  // members, and a class that borrows another one's members answers with those
  const borrowed = []

  if (facade && facade.root && doc.methods.length === 0) {
    borrowed.push(facade.root)
  }

  for (const mixin of doc.mixins) {
    borrowed.push(mixin)
  }

  for (const name of borrowed) {
    const remaining = options.budget

    if (!remaining || remaining.left <= 0 || typeof options.fetch !== 'function') {
      break
    }

    remaining.left -= 1
    const other = entryOf(intel, name, options.fetch)

    if (!other) {
      continue
    }

    for (const member of classMembers(intel, other.class, {static: wanted, item: options.item, fetch: options.fetch, budget: remaining})) {
      collected.add({...member, sort: groupOf(intel, name)})
    }
  }

  return collected.list
}

/**
 * What a model answers statically: the model's own statics, the builder's
 * methods, and the scopes it writes.
 *
 * @param {Object|null} intel
 * @param {Object} model
 * @returns {Array<Object>}
 */
/**
 * The query builder's methods, seen from a chain that is an eloquent one.
 *
 * The eloquent builder declares 154 methods and forwards everything else to the
 * query builder, taking its own place back when that one answers `$this`: so
 * `User::orderBy()` is still a builder of users, and `User::count()` is a number.
 *
 * @param {Object|null} intel
 * @param {String|null} binding the model the chain collects
 * @returns {Array<Object>}
 */
const queryTable = (intel, binding) => {
  return builderTable(intel, 'query', null).map(method => {
    const returns = method.returns

    if (!returns || returns.scalar || folded(returns.name) !== folded(framework.query)) {
      return method
    }

    return {...method, returns: binding ? {name: framework.eloquent, item: binding} : {name: framework.eloquent}}
  })
}

const modelStatics = (intel, model) => {
  const collected = collector()
  const name = model.class
  const builder = {name: framework.eloquent, item: name}

  collected.addAll(classMembers(intel, framework.model, {static: true, item: name}))

  for (const method of builderTable(intel, 'eloquent', name)) {
    collected.add({...method, static: true, sort: groupOf(intel, framework.eloquent)})
  }

  for (const method of queryTable(intel, name)) {
    collected.add({...method, static: true, sort: groupOf(intel, framework.query)})
  }

  for (const scope of scopesOf(intel, name)) {
    collected.add({
      kind: 'scope',
      name: scope,
      static: true,
      params: [],
      returns: builder,
      declaring: name,
      sort: '1',
    })
  }

  return collected.list
}

/**
 * What a model answers on an instance: its columns, the models it reaches, its
 * scopes, the model methods it inherits, and the builder behind it.
 *
 * The order is the order of likelihood: `$user->` is nearly always a column.
 *
 * @param {Object|null} intel
 * @param {Object} model
 * @returns {Array<Object>}
 */
const modelInstances = (intel, model) => {
  const collected = collector()
  const name = model.class

  for (const attribute of attributesOf(intel, name)) {
    collected.add({
      kind: 'attribute',
      name: attribute.name,
      static: false,
      params: [],
      returns: attribute.type,
      declaring: name,
      sort: '0',
    })
  }

  for (const relation of relationsOf(intel, name)) {
    collected.add({
      kind: 'relation',
      name: relation.name,
      static: false,
      params: [],
      returns: relation.many ? {name: framework.collection, item: relation.related} : {name: relation.related},
      related: relation.related,
      many: relation.many,
      declaring: name,
      sort: '0',
    })
  }

  for (const scope of scopesOf(intel, name)) {
    collected.add({
      kind: 'scope',
      name: scope,
      static: false,
      params: [],
      returns: {name: framework.eloquent, item: name},
      declaring: name,
      sort: '1',
    })
  }

  collected.addAll(classMembers(intel, framework.model, {static: false, item: name}))

  for (const method of builderTable(intel, 'eloquent', name)) {
    collected.add({...method, sort: groupOf(intel, framework.eloquent)})
  }

  return collected.list
}

/**
 * The members of a name.
 *
 * @param {Object|null} intel
 * @param {String|null} fqcn the class, model, facade or builder
 * @param {{static?: Boolean, item?: String, fetch?: Function}} [options]
 * @returns {Array<Object>}
 */
const membersOf = (intel, fqcn, options = {}) => {
  // `User::` is written the way a snippet writes it, and so is a type a docblock
  // answered with: the name is settled here rather than left to every caller
  const name = resolveClass(intel, fqcn)

  if (!name) {
    return []
  }

  const model = modelOf(intel, name)

  if (model) {
    return options.static === true ? modelStatics(intel, model) : modelInstances(intel, model)
  }

  // a builder is two builders: the eloquent one declares 154 methods and hands
  // everything else to the query builder under it
  if (folded(name) === folded(framework.eloquent)) {
    const collected = collector()

    for (const method of builderTable(intel, 'eloquent', options.item || null)) {
      collected.add({...method, sort: groupOf(intel, name)})
    }

    for (const method of queryTable(intel, options.item || null)) {
      collected.add({...method, sort: groupOf(intel, framework.query)})
    }

    return collected.list
  }

  if (folded(name) === folded(framework.query)) {
    return builderTable(intel, 'query', null).map(method => ({...method, sort: groupOf(intel, name)}))
  }

  return classMembers(intel, name, {
    static: options.static === true,
    item: options.item,
    fetch: options.fetch,
    budget: {left: 2},
  })
}

/**
 * What one member answers: `get()` on a builder answers a collection of models.
 *
 * @param {Object|null} intel
 * @param {Object|null} type the type the member was read on
 * @param {Object|null} member
 * @param {Object} [options]
 * @returns {Object|null} the shared Type
 */
const returnOf = (intel, type, member, options = {}) => {
  if (!member) {
    return null
  }

  if (member.returns) {
    return member.returns
  }

  // a relation carries what it reaches even when nothing was typed for it
  if (member.related) {
    return member.many ? {name: framework.collection, item: member.related} : {name: member.related}
  }

  return null
}

/**
 * The type of a property read on a type: a model's column, a class's property, a
 * docblock's magic one.
 *
 * @param {Object|null} intel
 * @param {Object|null} type
 * @param {String} name the property, with or without its `$`
 * @param {{fetch?: Function}} [options]
 * @returns {Object|null} the shared Type
 */
const propertyType = (intel, type, name, options = {}) => {
  const wanted = clean(name).replace(/^\$/, '')

  if (!type || !type.name || !wanted) {
    return null
  }

  const members = membersOf(intel, type.name, {static: false, item: type.item, fetch: options.fetch})
  const member = members.find(entry => entry.name.toLowerCase() === wanted.toLowerCase() && entry.kind !== 'method')

  return member ? returnOf(intel, type, member, options) : null
}

/**
 * The types the helpers of the framework answer, for the calls that are worth
 * knowing in a snippet: `now()->` is a date, `collect()->` is a collection.
 */
const frameworkFunctions = {
  now: {name: framework.carbon},
  today: {name: framework.carbon},
  collect: {name: framework.collection},
  str: {name: 'Illuminate\\Support\\Stringable'},
  request: {name: 'Illuminate\\Http\\Request'},
  response: {name: 'Illuminate\\Http\\Response'},
  redirect: {name: 'Illuminate\\Http\\RedirectResponse'},
  validator: {name: 'Illuminate\\Validation\\Validator'},
  session: {name: 'Illuminate\\Session\\Store'},
}

/**
 * What a function call answers.
 *
 * A function the project itself declares is taken at its word, because its return
 * type is the only one the read can vouch for; a framework helper answers from the
 * short list of the ones a snippet chains off.
 *
 * @param {Object|null} intel
 * @param {String|null} name
 * @returns {Object|null} the shared Type
 */
const functionReturn = (intel, name) => {
  const called = clean(name)

  if (!called) {
    return null
  }

  // the helpers a snippet chains off are answered from what they are, not from the
  // interface their docblock names: `now()` is a date, not a contract about one
  const known = frameworkFunctions[folded(called)]

  if (known) {
    return known
  }

  const functions = (intel && Array.isArray(intel.functions)) ? intel.functions : []
  const declared = functions.find(entry => entry && entry.name && folded(entry.name) === folded(called))

  return declared && declared.returns ? typeFrom(declared.returns) : null
}

/**
 * The strings a call takes, for the arguments no editor can guess: a config key,
 * a route name, a view, an env name, a translation key, a container binding.
 *
 * Only names leave the read, never values: a key is what a snippet needs.
 *
 * @param {Object|null} intel
 * @param {String} kind config|route|view|env|trans|binding
 * @returns {Array<{value: String, detail: String|undefined}>}
 */
const strings = (intel, kind) => {
  const data = intel || {}
  const list = value => (Array.isArray(value) ? value : [])
  const nameOf = entry => (typeof entry === 'string' ? entry : clean(entry && entry.name))

  if (kind === 'config') {
    return list(data.config).map(entry => ({value: nameOf(entry)})).filter(entry => entry.value !== '')
  }

  if (kind === 'route') {
    return list(data.routes)
      .filter(route => route && route.name)
      .map(route => ({value: route.name, detail: route.uri || undefined}))
  }

  if (kind === 'view') {
    return list(data.views)
      .filter(view => view && view.name)
      .map(view => ({value: view.name, detail: view.name.includes('::') ? 'vendor' : undefined}))
  }

  if (kind === 'env') {
    return list(data.env).map(entry => ({value: nameOf(entry)})).filter(entry => entry.value !== '')
  }

  if (kind === 'trans') {
    return list(data.translations).map(entry => ({value: nameOf(entry)})).filter(entry => entry.value !== '')
  }

  if (kind === 'binding') {
    return list(data.bindings)
      .filter(binding => binding && binding.name)
      .map(binding => ({value: binding.name, detail: binding.kind || undefined}))
  }

  return []
}

/**
 * The functions the project and the framework declare, for the names a snippet
 * calls on their own.
 *
 * @param {Object|null} intel
 * @returns {Array<{name: String, params: Array<String>}>}
 */
const functions = intel => {
  const list = (intel && Array.isArray(intel.functions)) ? intel.functions : []

  return list
    .filter(entry => entry && entry.name)
    .map(entry => ({name: entry.name, params: Array.isArray(entry.params) ? entry.params : []}))
}

/**
 * The global constants the read found.
 *
 * @param {Object|null} intel
 * @returns {Array<String>}
 */
const constants = intel => {
  const list = (intel && Array.isArray(intel.constants)) ? intel.constants : []

  return list.filter(name => typeof name === 'string' && name !== '')
}

module.exports = {
  membersOf,
  returnOf,
  propertyType,
  functionReturn,
  strings,
  functions,
  constants,
  resolveClass,
  isKnown,
  isOwn,
  shortName,
}
