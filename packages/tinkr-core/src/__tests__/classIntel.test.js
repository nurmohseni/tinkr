// what a popup asks about a name, answered from the project's own read, with no
// php under it: this is the whole of what a keystroke may cost
const {
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
} = require('../classIntel')

const framework = {
  model: 'Illuminate\\Database\\Eloquent\\Model',
  eloquent: 'Illuminate\\Database\\Eloquent\\Builder',
  query: 'Illuminate\\Database\\Query\\Builder',
  collection: 'Illuminate\\Support\\Collection',
  eloquentCollection: 'Illuminate\\Database\\Eloquent\\Collection',
  carbon: 'Illuminate\\Support\\Carbon',
}

const method = (name, returns, params = []) => ({name, static: false, params, returns, declaring: framework.eloquent})
const staticMethod = (name, returns, params = [], declaring = framework.model) => ({
  name, static: true, params, returns, declaring,
})

// the read of a project with one model in it, in the shape intelScript emits
const intel = {
  version: 1,
  project: '/var/www/app',
  booted: true,
  models: [
    {
      class: 'App\\Models\\User',
      table: 'users',
      key: 'id',
      keyType: 'int',
      attributes: [
        {name: 'id', type: 'integer', nullable: false, default: null},
        {name: 'email', type: 'string', nullable: false, default: null},
        {name: 'email_verified_at', type: 'datetime', nullable: true, default: null},
        {name: 'is_admin', type: 'boolean', nullable: false, default: false},
      ],
      casts: {is_admin: 'bool'},
      appends: ['avatar'],
      hidden: ['password'],
      relations: [
        {name: 'posts', related: 'App\\Models\\Post', relation: 'HasMany', many: true},
        {name: 'team', related: 'App\\Models\\Team', relation: 'BelongsTo', many: false},
      ],
      scopes: ['active'],
    },
  ],
  classes: {
    [framework.model]: {
      class: framework.model,
      kind: 'class',
      abstract: true,
      doc: '/** The base model. */',
      methods: [
        staticMethod('query', `\\${framework.eloquent}`),
        {name: 'save', static: false, params: [], returns: 'bool', declaring: framework.model},
        {name: 'fill', static: false, params: ['array $attributes'], returns: 'static', declaring: framework.model},
        {name: 'delete', static: false, params: [], returns: 'bool|null', declaring: framework.model},
      ],
      properties: [{name: 'attributes', static: false, type: 'array', declaring: framework.model}],
      constants: [{name: 'CREATED_AT', declaring: framework.model}],
    },
    [framework.collection]: {
      class: framework.collection,
      kind: 'class',
      methods: [
        method('map', 'static', ['callable $callback']),
        method('first', 'TModel|null'),
        method('pluck', `\\${framework.collection}`, ['string $value']),
      ],
      properties: [],
      constants: [],
    },
    [framework.eloquentCollection]: {
      class: framework.eloquentCollection,
      kind: 'class',
      methods: [
        method('map', 'static'),
        method('modelKeys', 'array'),
      ],
      properties: [],
      constants: [],
    },
  },
  builders: {
    eloquent: [
      {name: 'where', params: ['string|array $column', 'mixed $operator = null'], returns: '$this'},
      {name: 'orderBy', params: ['string $column', 'string $direction = \'asc\''], returns: '$this'},
      {name: 'get', params: ['array $columns = [\'*\']'], returns: `\\${framework.eloquentCollection}<int, TModel>`},
      {name: 'first', params: ['array $columns = [\'*\']'], returns: 'TModel|null'},
      {name: 'find', params: ['mixed $id'], returns: 'TModel|null'},
      {name: 'paginate', params: ['int $perPage = 15'], returns: '\\Illuminate\\Pagination\\LengthAwarePaginator'},
      {name: 'count', params: [], returns: 'int'},
      {name: 'create', params: ['array $attributes'], returns: 'TModel'},
      {name: 'updateOrCreate', params: ['array $attributes', 'array $values = []'], returns: 'TModel'},
    ],
    query: [
      {name: 'select', params: ['mixed $columns = [\'*\']'], returns: '$this'},
      {name: 'toSql', params: [], returns: 'string'},
      {name: 'orderBy', params: ['string $column', 'string $direction = \'asc\''], returns: '$this'},
      {name: 'count', params: ['string $columns = \'*\''], returns: 'int'},
    ],
  },
  facades: {
    'Illuminate\\Support\\Facades\\Cache': {
      root: 'Illuminate\\Cache\\CacheManager',
      doc: '/**\n * @method static mixed get(string $key, mixed $default = null)\n * @method static bool put(string $key, mixed $value, mixed $ttl = null)\n * @method static mixed remember(string $key, mixed $ttl, \\Closure $callback)\n */',
    },
    'Illuminate\\Support\\Facades\\DB': {
      root: null,
      doc: '/**\n * @method static \\Illuminate\\Database\\Query\\Builder table(string $table)\n * @method static bool statement(string $query, array $bindings = [])\n */',
    },
  },
  config: ['app.name', 'app.timezone', 'database.default', 'cache.default'],
  routes: [{name: 'home', uri: '/', methods: ['GET']}, {name: 'users.show', uri: 'users/{user}', methods: ['GET']}],
  views: [{name: 'welcome', path: '/var/www/app/resources/views/welcome.blade.php'}, {name: 'mail::message', path: '/vendor/x/mail/message.blade.php'}],
  translations: ['auth.failed'],
  env: ['APP_KEY', 'APP_ENV'],
  bindings: [{name: 'Illuminate\\Contracts\\Auth\\Factory', kind: 'singleton'}],
  functions: [
    {name: 'my_helper', params: ['string $name'], returns: 'App\\Support\\Greeting', user: true},
    {name: 'collect', params: ['mixed $value = null'], returns: '\\Illuminate\\Support\\Collection', user: false},
  ],
  constants: ['PHP_EOL', 'PHP_INT_MAX'],
  own: ['app\\', 'tests\\'],
}

const named = (members, name) => members.find(member => member.name === name)

describe('the members of a model', () => {
  test('a model answers with its columns first, in the order it declares them', () => {
    const members = membersOf(intel, 'App\\Models\\User')
    const attributes = members.filter(member => member.kind === 'attribute')

    expect(attributes.map(member => member.name)).toEqual(['id', 'email', 'email_verified_at', 'is_admin', 'avatar'])
    expect(named(members, 'id').returns).toEqual({scalar: 'int'})
    expect(named(members, 'email').returns).toEqual({scalar: 'string'})
    // a date column is a date whatever the driver calls it
    expect(named(members, 'email_verified_at').returns).toEqual({name: framework.carbon})
    // an appended attribute is offered even though no column writes it
    expect(named(members, 'avatar').returns).toBe(null)
    expect(members.slice(0, 5).every(member => member.sort === '0')).toBe(true)
  })

  test('a relation is offered after the columns, and says what it reaches', () => {
    const members = membersOf(intel, 'App\\Models\\User')
    const posts = named(members, 'posts')

    expect(posts).toMatchObject({kind: 'relation', related: 'App\\Models\\Post', many: true, sort: '0'})
    expect(posts.returns).toEqual({name: framework.collection, item: 'App\\Models\\Post'})
    expect(named(members, 'team').returns).toEqual({name: 'App\\Models\\Team'})
    expect(members.indexOf(posts)).toBeGreaterThan(members.findIndex(member => member.kind === 'attribute'))
    expect(members.indexOf(posts)).toBeLessThan(members.findIndex(member => member.kind === 'method'))
  })

  test('a scope is called as a method of the model, and the chain stays on the builder', () => {
    const members = membersOf(intel, 'App\\Models\\User')
    const active = named(members, 'active')

    expect(active).toMatchObject({kind: 'scope', static: false, sort: '1'})
    expect(active.returns).toEqual({name: framework.eloquent, item: 'App\\Models\\User'})
  })

  test('a model instance answers with the model\'s own methods and the builder\'s chain', () => {
    const members = membersOf(intel, 'App\\Models\\User')

    expect(named(members, 'save').kind).toBe('method')
    expect(named(members, 'where').kind).toBe('method')
    expect(named(members, 'where').sort).toBe('3')
  })

  test('a short name is settled before it is asked about', () => {
    // `User::` is what a snippet writes; nothing imports the class there
    expect(membersOf(intel, 'User', {static: true})).toEqual(membersOf(intel, 'App\\Models\\User', {static: true}))
  })
})

describe('the members of a model, statically', () => {
  test('a model answers where, first, find, create, without the members it has on an instance', () => {
    const members = membersOf(intel, 'App\\Models\\User', {static: true})
    const names = members.map(member => member.name)

    for (const wanted of ['where', 'first', 'find', 'create', 'updateOrCreate', 'query']) {
      expect(names).toContain(wanted)
    }

    // save and fill are what an instance does, and a call on the class is not one
    expect(names).not.toContain('save')
    expect(names).not.toContain('fill')
    // the method is declared on the builder, but the call written here is a static
    // one: what the popup offers has to be callable where the caret is
    expect(named(members, 'where').static).toBe(true)
    expect(named(members, 'where').params).toEqual(['string|array $column', 'mixed $operator = null'])
  })

  test('a call that answers a model is the model, and one that answers a collection is that', () => {
    const statics = membersOf(intel, 'App\\Models\\User', {static: true})

    expect(returnOf(intel, {name: 'App\\Models\\User'}, named(statics, 'first'))).toEqual({name: 'App\\Models\\User'})
    expect(returnOf(intel, {name: 'App\\Models\\User'}, named(statics, 'find'))).toEqual({name: 'App\\Models\\User'})
    expect(returnOf(intel, {name: 'App\\Models\\User'}, named(statics, 'where')))
      .toEqual({name: framework.eloquent, item: 'App\\Models\\User'})
    expect(returnOf(intel, {name: 'App\\Models\\User'}, named(statics, 'get')))
      .toEqual({name: framework.eloquentCollection, item: 'App\\Models\\User'})
    // a scalar answers nothing to chain on, which is the empty popup rather than a
    // wrong list
    expect(returnOf(intel, {name: 'App\\Models\\User'}, named(statics, 'count'))).toEqual({scalar: 'int'})

    // what the eloquent builder forwards is the query builder's, and it answers
    // the model it was called on: `User::select()` is still a builder of users
    expect(returnOf(intel, {name: 'App\\Models\\User'}, named(statics, 'select')))
      .toEqual({name: framework.eloquent, item: 'App\\Models\\User'})
    expect(named(statics, 'toSql').returns).toEqual({scalar: 'string'})
    expect(named(statics, 'orderBy').static).toBe(true)
  })
})

describe('the members of a builder', () => {
  test('the chain stays on the builder for as long as it is chained', () => {
    const members = membersOf(intel, framework.eloquent, {item: 'App\\Models\\User'})

    expect(members.map(member => member.name)).toContain('orderBy')
    // the eloquent builder is the query builder under it, and both are offered
    expect(members.map(member => member.name)).toContain('select')
    expect(returnOf(intel, {name: framework.eloquent}, named(members, 'orderBy')))
      .toEqual({name: framework.eloquent, item: 'App\\Models\\User'})
    expect(returnOf(intel, {name: framework.eloquent}, named(members, 'paginate')))
      .toEqual({name: 'Illuminate\\Pagination\\LengthAwarePaginator'})
  })
})

describe('the members of a facade', () => {
  test('a facade answers the manager it documents, and is known by its short name', () => {
    expect(resolveClass(intel, 'Cache')).toBe('Illuminate\\Support\\Facades\\Cache')

    const members = membersOf(intel, 'Cache', {static: true})

    expect(members.map(member => member.name)).toEqual(['get', 'put', 'remember'])
    expect(named(members, 'get').params).toEqual(['string $key', 'mixed $default = null'])
    expect(named(members, 'get').returns).toBe(null)
    expect(membersOf(intel, 'DB', {static: true}).map(member => member.name)).toEqual(['table', 'statement'])
  })

  test('a class the read did not carry is asked for through fetch', () => {
    const asked = []
    const str = {
      class: 'Illuminate\\Support\\Str',
      kind: 'class',
      methods: [
        staticMethod('slug', 'string', ['string $title'], 'Illuminate\\Support\\Str'),
        staticMethod('random', 'string', ['int $length = 16'], 'Illuminate\\Support\\Str'),
      ],
      properties: [],
      constants: [],
    }
    const members = membersOf(intel, 'Str', {
      static: true,
      fetch: name => {
        asked.push(name)

        return name === 'Illuminate\\Support\\Str' ? str : null
      },
    })

    expect(asked).toEqual(['Illuminate\\Support\\Str'])
    expect(members.map(member => member.name)).toEqual(['slug', 'random'])
  })

  test('a mixin cycle ends instead of going round it', () => {
    const loop = {
      version: 1,
      classes: {
        'App\\Loop': {
          class: 'App\\Loop',
          kind: 'class',
          doc: '/** @mixin \\App\\Loop */',
          methods: [{name: 'once', static: false, params: [], returns: 'void', declaring: 'App\\Loop'}],
          properties: [],
          constants: [],
        },
      },
      own: ['app\\'],
    }

    expect(membersOf(loop, 'App\\Loop').map(member => member.name)).toEqual(['once'])
  })
})

describe('what a name is and where it comes from', () => {
  test('a class the read carries is known, one it does not is not', () => {
    expect(isKnown(intel, 'App\\Models\\User')).toBe(true)
    expect(isKnown(intel, 'Illuminate\\Support\\Facades\\Cache')).toBe(true)
    // a framework class with one name is answerable even when the read did not
    // carry it, and one that is nowhere is not guessed at
    expect(isKnown(intel, 'Str')).toBe(true)
    expect(isKnown(intel, 'Nope')).toBe(false)
    expect(resolveClass(intel, 'Nope')).toBe(null)
    expect(membersOf(intel, 'Nope')).toEqual([])
    expect(membersOf(intel, 'Nope', {fetch: () => { throw new Error('asked about nothing') }})).toEqual([])
  })

  test('a project class is told from a vendor one', () => {
    expect(isOwn(intel, 'App\\Models\\User')).toBe(true)
    expect(isOwn(intel, 'App\\Http\\Controllers\\UserController')).toBe(true)
    expect(isOwn(intel, 'Illuminate\\Support\\Collection')).toBe(false)
  })

  test('the helpers a snippet chains off answer with their own type', () => {
    expect(functionReturn(intel, 'now')).toEqual({name: framework.carbon})
    expect(functionReturn(intel, 'collect')).toEqual({name: framework.collection})
    // a function the project declares is taken at its word
    expect(functionReturn(intel, 'my_helper')).toEqual({name: 'App\\Support\\Greeting'})
    expect(functionReturn(intel, 'nope_helper')).toBe(null)
  })

  test('a model property is typed by its column', () => {
    expect(propertyType(intel, {name: 'App\\Models\\User'}, 'email')).toEqual({scalar: 'string'})
    expect(propertyType(intel, {name: 'App\\Models\\User'}, '$posts')).toEqual({name: framework.collection, item: 'App\\Models\\Post'})
    expect(propertyType(intel, {name: 'App\\Models\\User'}, 'nope')).toBe(null)
  })
})

describe('the strings a call takes', () => {
  test('config, routes, views, env, translations and bindings, as names', () => {
    expect(strings(intel, 'config').map(entry => entry.value)).toContain('app.timezone')
    expect(strings(intel, 'route')).toEqual([
      {value: 'home', detail: '/'},
      {value: 'users.show', detail: 'users/{user}'},
    ])
    expect(strings(intel, 'view').map(entry => entry.value)).toEqual(['welcome', 'mail::message'])
    expect(strings(intel, 'view')[1].detail).toBe('vendor')
    expect(strings(intel, 'env').map(entry => entry.value)).toEqual(['APP_KEY', 'APP_ENV'])
    expect(strings(intel, 'trans').map(entry => entry.value)).toEqual(['auth.failed'])
    expect(strings(intel, 'binding')).toEqual([{value: 'Illuminate\\Contracts\\Auth\\Factory', detail: 'singleton'}])
    expect(strings(intel, 'nope')).toEqual([])
  })

  test('functions and constants are names and parameter lines, with nothing of the value', () => {
    expect(functions(intel)).toEqual([
      {name: 'my_helper', params: ['string $name']},
      {name: 'collect', params: ['mixed $value = null']},
    ])
    expect(constants(intel)).toEqual(['PHP_EOL', 'PHP_INT_MAX'])
    expect(functions(null)).toEqual([])
    expect(constants(null)).toEqual([])
    expect(strings(null, 'config')).toEqual([])
  })
})
