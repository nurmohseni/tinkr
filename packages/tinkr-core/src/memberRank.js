/**
 * Where a member sits in a popup that has nothing typed in it.
 *
 * A read answers in the order reflection walks a class, which is not the order a
 * snippet is written in: `User::` opens with `clearBootedModels`, `withoutTouching`
 * and `resolveConnection`, and `where` is ninety entries down; `now()->` opens with
 * `copy` and `timezone`, and `format` is eighteenth. Typing narrows that list, but
 * the popup of a bare `::` or `->` is exactly the moment a person is looking for
 * the call they make every day.
 *
 * So every member is put in a tier, and the tiers are this file's data:
 *
 *   0  the names people write most, for the classes where that is worth knowing:
 *      a model's statics, a builder, a collection, a date, a cache, a database
 *   1  what the class being completed declares itself — the project's own model,
 *      its scopes, the service it is writing
 *   2  what the object a facade resolves to declares, so a repository's `get`
 *      outranks the manager that hands it out
 *   5  everything else, in the order it was read
 *   9  the framework's plumbing: booting, macro registries, magic methods
 *
 * The tiers are built once, when this module is loaded, and scoring a member is a
 * `Map.get` and, at worst, a handful of regular expressions. Nothing here reads a
 * project, starts a process or touches a file.
 */

const {framework, modelOf} = require('./modelIntel')

/**
 * A name without the leading separator a docblock writes, folded for comparing:
 * php names are not case sensitive.
 *
 * @param {String|null} value
 * @return {String}
 */
const folded = value => String(value == null ? '' : value).replace(/^\\+/, '').trim().toLowerCase()

/**
 * The last segment of a name: `Cache` for `Illuminate\Support\Facades\Cache`.
 *
 * @param {String|null} fqcn
 * @return {String}
 */
const shortName = fqcn => {
  const name = String(fqcn == null ? '' : fqcn).replace(/^\\+/, '').trim()
  const at = name.lastIndexOf('\\')

  return at === -1 ? name : name.slice(at + 1)
}

// the tier a member can sit in, as the first digit of its rank: one digit, so the
// ranks of two lists compare as strings the way the editor already compares them
const tiers = {curated: '0', own: '1', root: '2', rest: '5', plumbing: '9'}

/**
 * The members a snippet is written with, family by family.
 *
 * The order is the order of likelihood, not the alphabet: `get` is what a builder
 * chain is asked for and `getQuery` is not. A name a family writes and the read
 * does not answer costs nothing — it is a table entry that never matches — so the
 * lists can be written for the framework as a whole rather than for one version
 * of it.
 *
 * `owners` are matched against the class being completed as it is spelled in the
 * read; `facades` against the short name of a class the read knows as a facade,
 * and of the object behind it.
 */
const families = [
  {
    key: 'model',
    // a model answers statically what its builder answers, plus its own scopes
    statics: [
      'where', 'find', 'create', 'all', 'first', 'with', 'query', 'count',
      'findOrFail', 'latest', 'orderBy', 'paginate', 'get', 'pluck', 'firstWhere',
      'updateOrCreate', 'firstOrCreate', 'exists', 'destroy', 'insert', 'upsert',
      'sum', 'max', 'min', 'avg', 'value', 'select', 'limit', 'take', 'withCount',
      'whereIn', 'orWhere', 'whereNull', 'whereNotNull', 'chunk', 'each', 'lazy',
      'make', 'update', 'delete', 'truncate', 'findMany', 'findOr', 'firstOrFail',
      'sole', 'firstOrNew', 'createOrFirst', 'forceCreate', 'increment',
    ],
    // an instance is a row, a relation or a call on it: the columns and relations
    // are the groups above this one, so this list is the calls
    instances: [
      'save', 'update', 'delete', 'refresh', 'load', 'loadMissing', 'toArray',
      'toJson', 'fill', 'replicate', 'is', 'isNot', 'associate', 'dissociate',
      'sync', 'attach', 'detach', 'increment', 'decrement', 'touch', 'push',
      'getKey', 'getAttribute', 'setAttribute', 'only', 'except', 'fresh', 'wasChanged',
    ],
  },
  {
    key: 'eloquent',
    owners: [framework.eloquent],
    methods: [
      'get', 'first', 'where', 'orderBy', 'paginate', 'pluck', 'count', 'latest',
      'find', 'take', 'limit', 'select', 'exists', 'when', 'chunk', 'update',
      'delete', 'insert', 'upsert', 'sum', 'max', 'min', 'avg', 'value', 'toSql',
      'dd', 'dump', 'cursor', 'lazy', 'each', 'firstOrFail', 'simplePaginate',
      'with', 'whereIn', 'orWhere', 'whereNull', 'whereNotNull', 'groupBy',
      'having', 'join', 'leftJoin', 'withCount', 'load', 'lockForUpdate',
    ],
  },
  {
    key: 'query',
    owners: [framework.query],
    methods: [
      'get', 'first', 'where', 'select', 'insert', 'update', 'delete', 'orderBy',
      'join', 'leftJoin', 'count', 'paginate', 'pluck', 'limit', 'take', 'offset',
      'exists', 'sum', 'max', 'min', 'avg', 'value', 'groupBy', 'having', 'when',
      'whereIn', 'orWhere', 'whereNull', 'insertGetId', 'upsert', 'increment',
      'decrement', 'chunk', 'toSql', 'dd', 'dump', 'raw', 'distinct',
    ],
  },
  {
    key: 'collection',
    owners: [framework.collection],
    methods: [
      'map', 'filter', 'each', 'pluck', 'first', 'sum', 'contains', 'get', 'all',
      'keys', 'values', 'count', 'isEmpty', 'isNotEmpty', 'merge', 'sort',
      'sortBy', 'groupBy', 'keyBy', 'unique', 'reduce', 'take', 'slice', 'last',
      'implode', 'join', 'toArray', 'toJson', 'transform', 'when', 'where',
      'firstWhere', 'max', 'min', 'avg', 'chunk', 'push', 'put', 'forget',
      'search', 'pop', 'shift', 'flip', 'flatMap', 'zip', 'combine', 'except',
      'only', 'partition', 'skip',
    ],
  },
  {
    key: 'lazyCollection',
    owners: ['Illuminate\\Support\\LazyCollection'],
    methods: [
      'map', 'filter', 'each', 'pluck', 'first', 'sum', 'contains', 'take',
      'chunk', 'keys', 'values', 'count', 'isEmpty', 'merge', 'sortBy', 'groupBy',
      'keyBy', 'unique', 'reduce', 'slice', 'last', 'toArray', 'when',
    ],
  },
  {
    key: 'carbon',
    owners: [framework.carbon, framework.carbonImmutable, 'Carbon\\Carbon', 'Carbon\\CarbonImmutable'],
    facades: ['Carbon'],
    methods: [
      'format', 'addDays', 'subDays', 'diffForHumans', 'startOfDay', 'endOfDay',
      'addHours', 'subHours', 'addMinutes', 'subMinutes', 'addMonths', 'subMonths',
      'addYears', 'subYears', 'addSeconds', 'subSeconds', 'timestamp',
      'toDateString', 'toDateTimeString', 'toIso8601String', 'isPast', 'isFuture',
      'isToday', 'isYesterday', 'startOfMonth', 'endOfMonth', 'startOfWeek',
      'endOfWeek', 'diffInDays', 'diffInHours', 'diffInMinutes', 'diffInSeconds',
      'now', 'today', 'parse', 'copy', 'timezone', 'setTimezone', 'gt', 'lt',
      'eq', 'between', 'max', 'min', 'next', 'previous', 'hour', 'minute', 'day',
      'month', 'year',
    ],
  },
  {
    key: 'cache',
    owners: [
      'Illuminate\\Cache\\Repository',
      'Illuminate\\Contracts\\Cache\\Repository',
      'Illuminate\\Cache\\CacheManager',
      'Illuminate\\Support\\Facades\\Cache',
    ],
    facades: ['Cache'],
    methods: [
      'get', 'put', 'remember', 'forget', 'has', 'add', 'pull', 'rememberForever',
      'increment', 'decrement', 'flush', 'missing', 'many', 'putMany',
      'getMultiple', 'set', 'forever', 'clear', 'flexible', 'lock', 'tags',
    ],
  },
  {
    key: 'db',
    owners: [
      'Illuminate\\Database\\Connection',
      'Illuminate\\Database\\DatabaseManager',
      'Illuminate\\Database\\MySqlConnection',
      'Illuminate\\Database\\PostgresConnection',
      'Illuminate\\Database\\SQLiteConnection',
      'Illuminate\\Support\\Facades\\DB',
    ],
    facades: ['DB'],
    methods: [
      'table', 'select', 'statement', 'transaction', 'connection', 'raw', 'insert',
      'update', 'delete', 'selectOne', 'transactionLevel', 'beginTransaction',
      'commit', 'rollback', 'getPdo', 'listen', 'pretend', 'enableQueryLog',
      'disableQueryLog', 'getQueryLog', 'getDatabaseName', 'unprepared',
      'selectResultSets', 'affectingStatement',
    ],
  },
  {
    key: 'str',
    owners: ['Illuminate\\Support\\Str', 'Illuminate\\Support\\Facades\\Str'],
    facades: ['Str'],
    methods: [
      'of', 'contains', 'startsWith', 'endsWith', 'slug', 'camel', 'snake',
      'studly', 'title', 'ucfirst', 'upper', 'lower', 'limit', 'length', 'random',
      'replace', 'before', 'after', 'between', 'is', 'isJson', 'isUuid', 'uuid',
      'ulid', 'ascii', 'words', 'wordCount', 'mask', 'padLeft', 'padRight',
      'squish', 'headline', 'take', 'finish', 'start', 'repeat', 'substr',
      'toString', 'numbers', 'replaceFirst', 'replaceLast', 'plural', 'singular',
    ],
  },
  {
    key: 'arr',
    owners: ['Illuminate\\Support\\Arr', 'Illuminate\\Support\\Facades\\Arr'],
    facades: ['Arr'],
    methods: [
      'get', 'has', 'add', 'set', 'forget', 'pull', 'first', 'last', 'only',
      'except', 'pluck', 'where', 'whereIn', 'map', 'filter', 'reduce', 'each',
      'merge', 'keys', 'values', 'flatten', 'collapse', 'sort', 'groupBy', 'keyBy',
      'unique', 'contains', 'random', 'shuffle', 'chunk', 'dot', 'undot',
      'isList', 'isAssoc', 'join', 'prepend', 'push', 'query', 'wrap', 'take',
      'reverse', 'divide', 'exists', 'accessible', 'toCssClasses',
    ],
  },
  {
    key: 'http',
    owners: ['Illuminate\\Http\\Client\\Factory', 'Illuminate\\Support\\Facades\\Http'],
    facades: ['Http'],
    methods: [
      'get', 'post', 'put', 'patch', 'delete', 'head', 'withHeaders', 'withToken',
      'withBasicAuth', 'acceptJson', 'asJson', 'asForm', 'timeout', 'retry',
      'throw', 'withoutVerifying', 'withoutRedirecting', 'baseUrl',
      'withOptions', 'withUserAgent', 'pool', 'sink', 'beforeSending',
    ],
  },
  {
    key: 'storage',
    owners: [
      'Illuminate\\Filesystem\\FilesystemManager',
      'Illuminate\\Filesystem\\Filesystem',
      'Illuminate\\Support\\Facades\\Storage',
    ],
    facades: ['Storage'],
    methods: [
      'disk', 'put', 'get', 'exists', 'delete', 'url', 'temporaryUrl', 'files',
      'allFiles', 'size', 'lastModified', 'makeDirectory', 'deleteDirectory',
      'download', 'response', 'missing', 'path', 'prepend', 'append', 'json',
      'directories', 'copy', 'move', 'checksum', 'setVisibility', 'visibility',
    ],
  },
  {
    key: 'log',
    owners: [
      'Illuminate\\Log\\Logger',
      'Illuminate\\Log\\LogManager',
      'Illuminate\\Support\\Facades\\Log',
    ],
    facades: ['Log'],
    methods: [
      'info', 'error', 'warning', 'debug', 'notice', 'critical', 'alert',
      'emergency', 'log', 'channel', 'stack', 'withContext', 'shareContext',
    ],
  },
  {
    key: 'route',
    owners: ['Illuminate\\Routing\\Router', 'Illuminate\\Support\\Facades\\Route'],
    facades: ['Route'],
    methods: [
      'get', 'post', 'put', 'patch', 'delete', 'any', 'match', 'middleware',
      'group', 'prefix', 'name', 'domain', 'controller', 'resource', 'apiResource',
      'redirect', 'view', 'fallback', 'current', 'currentRouteName', 'has', 'is',
      'bind', 'getRoutes',
    ],
  },
  {
    key: 'request',
    owners: [
      'Illuminate\\Http\\Request',
      'Illuminate\\Support\\Facades\\Request',
      'Illuminate\\Http\\Client\\Request',
    ],
    facades: ['Request'],
    methods: [
      'input', 'all', 'only', 'except', 'get', 'has', 'filled', 'missing',
      'boolean', 'integer', 'string', 'date', 'file', 'hasFile', 'header',
      'headers', 'bearerToken', 'ip', 'url', 'fullUrl', 'path', 'method',
      'isMethod', 'query', 'post', 'cookie', 'session', 'user', 'userAgent',
      'validate', 'validated', 'collect', 'when', 'whenFilled',
    ],
  },
  {
    key: 'response',
    owners: [
      'Illuminate\\Http\\Response',
      'Illuminate\\Http\\JsonResponse',
      'Illuminate\\Http\\RedirectResponse',
      'Illuminate\\Routing\\ResponseFactory',
      'Illuminate\\Http\\Client\\Response',
      'Illuminate\\Support\\Facades\\Response',
    ],
    facades: ['Response'],
    methods: [
      'json', 'view', 'make', 'noContent', 'redirect', 'download', 'file',
      'stream', 'streamDownload', 'header', 'withHeaders', 'status', 'content',
      'getContent', 'setContent', 'getStatusCode', 'getHeaders', 'successful',
      'failed', 'clientError', 'serverError', 'body',
    ],
  },
]

// the names no popup should offer near the top: the framework starting itself up,
// registering what a class can be extended with, and the hooks php calls on its
// own. A class that declares one of them itself is not helped by it either
const plumbingPatterns = [
  // __call, __callStatic, __get, __toString: the language's hooks, not a call a
  // snippet makes
  /^__/,
  // boot, booted, bootIfNotBooted, bootTraits: the framework's start-up, and it
  // has already run by the time a snippet is written
  /^boot/,
  /^clearbooted/,
  // the lazy-loading switches of a model
  /^preventlazyloading$/,
  /^handlelazyloadingviolationusing$/,
  /^withouttouching/,
  // the container and the event dispatcher a class is wired to
  /^resolveconnection$/,
  /^(get|set|unset)[a-z]*resolver$/,
  /^(get|set|unset)eventdispatcher$/,
  // what a class can be extended with is not what it is asked to do
  /^(get|set|forget|flush)macro/,
  /^mixin$/,
  // the wiring of the manager behind a facade
  /^(get|set)application$/,
  /^refresheventdispatcher$/,
  /^calculatedynamicconnectionname$/,
  /^connectusing$/,
  /^setreconnector$/,
  /^(get|set|forget)defaultdriver$/,
  /^handleunserializableclassusing$/,
  /^create[a-z]*driver$/,
  /^forgetdisk$/,
  /^build$/,
  /^resolve$/,
  /^memo$/,
  /^repository$/,
  /^store$/,
  /^driver$/,
  /^purge$/,
  /^extend$/,
  // the facade's own machinery, and the fake a test replaces it with
  /^(get|set)facadeapplication$/,
  /^getfacaderoot$/,
  /^resolvefacadeinstance$/,
  /^clearresolvedinstance/,
  /^spy$/,
  /^shouldreceive$/,
  /^partialmock$/,
]

// a macro registry is read by its exact name: `hasMacro` and `macroCall` are not
// prefixes of each other, and `macro` alone is a name a project may declare. Every
// pattern above is written against a folded name, so these are folded too
const plumbingNames = new Set(['macro', 'hasmacro', 'flushmacros', 'macrocall'])

// what was already judged, by folded name: the same `getEventDispatcher` is met
// again on every keystroke of every class, and the answer does not change
const judged = new Map()

/**
 * Whether a member is the framework's plumbing rather than something a snippet is
 * written with.
 *
 * @param {String} name the folded member name
 * @return {Boolean}
 */
const isPlumbing = name => {
  if (!name) {
    return false
  }

  const known = judged.get(name)

  if (known !== undefined) {
    return known
  }

  const plumbing = plumbingNames.has(name) || plumbingPatterns.some(pattern => pattern.test(name))

  judged.set(name, plumbing)

  return plumbing
}

/**
 * A family's list, as the order a name sits at, built once.
 *
 * @param {Array<String>} names
 * @return {Map<String, String>}
 */
const orderOf = names => {
  const order = new Map()

  for (const [at, name] of (names || []).entries()) {
    if (!order.has(name.toLowerCase())) {
      order.set(name.toLowerCase(), String(at + 1).padStart(3, '0'))
    }
  }

  return order
}

// the tables, ready: a family's names by folded name and the order they are shown
// in, so a keystroke is a lookup and never a walk over the lists above
const prepared = new Map()

for (const family of families) {
  prepared.set(family.key, {
    statics: orderOf(family.statics || family.methods),
    instances: orderOf(family.instances || family.methods),
  })
}

const byOwner = new Map()

for (const family of families) {
  for (const owner of family.owners || []) {
    byOwner.set(folded(owner), family)
  }
}

const byFacade = new Map()

for (const family of families) {
  for (const facade of family.facades || []) {
    byFacade.set(facade.toLowerCase(), family)
  }
}

/**
 * The facade entry of a name, if the read has one.
 *
 * @param {Object|null} intel
 * @param {String} name folded
 * @return {Object|null}
 */
const facadeOf = (intel, name) => {
  const facades = (intel && intel.facades) || {}

  if (Object.prototype.hasOwnProperty.call(facades, name)) {
    return facades[name]
  }

  for (const key of Object.keys(facades)) {
    if (folded(key) === name) {
      return facades[key]
    }
  }

  return null
}

/**
 * The object a facade resolves to: what a `Cache::get` actually calls.
 *
 * @param {Object|null} intel
 * @param {String|null} owner
 * @return {String|null}
 */
const rootOf = (intel, owner) => {
  const name = folded(owner)
  const facade = name && facadeOf(intel, name)

  return facade && facade.root ? facade.root : null
}

/**
 * The curated list a class is ranked by, if it has one.
 *
 * A model is not in the table by name — a project's models are its own — so it is
 * answered from the read. Everything else is a class of the framework or of the
 * facade in front of it.
 *
 * @param {Object|null} intel
 * @param {String|null} owner
 * @param {Boolean} isStatic
 * @return {{key: String, order: Map<String, String>}|null}
 */
const familyFor = (intel, owner, isStatic) => {
  const name = folded(owner)

  if (!name) {
    return null
  }

  const ordered = family => ({
    key: family.key,
    order: (prepared.get(family.key) || {})[isStatic ? 'statics' : 'instances'] || new Map(),
  })

  if (modelOf(intel, name)) {
    return ordered({key: 'model'})
  }

  const exact = byOwner.get(name)

  if (exact) {
    return ordered(exact)
  }

  // a facade is completed by the names of the manager behind it, and the short
  // name is what a snippet writes: `Cache::`, `Str::`, `Http::`
  const root = rootOf(intel, name)

  if (!root && !facadeOf(intel, name)) {
    return null
  }

  const family = byOwner.get(folded(root)) || byFacade.get(shortName(root || owner).toLowerCase())

  return family ? ordered(family) : null
}

/**
 * The tier and curated order a single member sits at.
 *
 * @param {Object} member
 * @param {{order: Map<String, String>|null, owner: String, root: String|null, modelBase: String|null}} context
 * @return {String} four characters: the tier, and the place in the family's list
 */
const rankOf = (member, context) => {
  const name = folded(member && member.name)
  const order = context.order && context.order.get(name)

  if (order) {
    return `${tiers.curated}${order}`
  }

  const declaring = folded(member && member.declaring)

  // the class being completed is the project's own when it says so, and what it
  // declares itself is what the person writing it is working on
  if (declaring && declaring === context.owner) {
    return `${tiers.own}000`
  }

  if (!declaring && member && member.sort === '2') {
    return `${tiers.own}000`
  }

  // a facade answers with the object behind it: a cache repository's `get` is a
  // member of that object, and it is not the manager's plumbing
  if (context.root && declaring && declaring === context.root) {
    return `${tiers.root}000`
  }

  // a model's public switches — `incrementing`, `exists`, `timestamps` — are
  // declared on the framework's base and read by it; they are not a call
  if (context.modelBase && declaring === context.modelBase && member.kind === 'property') {
    return `${tiers.plumbing}000`
  }

  if (isPlumbing(name)) {
    return `${tiers.plumbing}000`
  }

  return `${tiers.rest}000`
}

/**
 * The tier each member of a list sits in, keyed by the member itself.
 *
 * @param {Array<Object>} members
 * @param {{intel?: Object|null, owner?: String|null, static?: Boolean}} [scope]
 * @return {Map<Object, String>}
 */
const memberRanks = (members, scope = {}) => {
  const owner = folded(scope.owner)
  const family = familyFor(scope.intel, owner, scope.static === true)
  const context = {
    order: family && family.order,
    owner,
    root: folded(rootOf(scope.intel, owner)) || null,
    modelBase: family && family.key === 'model' ? folded(framework.model) : null,
  }
  const ranks = new Map()

  for (const member of members || []) {
    ranks.set(member, rankOf(member, context))
  }

  return ranks
}

module.exports = {
  memberRanks,
  isPlumbing,
  familyFor,
}
