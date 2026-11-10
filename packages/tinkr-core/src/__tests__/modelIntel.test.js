// types are written, not computed: everything here reads a string the way a
// docblock or a signature writes one, and answers the shared `Type`
const {
  typeFrom,
  typeExpression,
  resolveName,
  attributeType,
  castType,
  attributesOf,
  relationsOf,
  scopesOf,
  builderTable,
} = require('../modelIntel')

describe('a written type, read', () => {
  test('a class is the class, and nothing else is invented for it', () => {
    expect(typeFrom('App\\Models\\User')).toEqual({name: 'App\\Models\\User'})
    expect(typeFrom('\\App\\Models\\User')).toEqual({name: 'App\\Models\\User'})
    expect(typeFrom('?App\\Models\\User')).toEqual({name: 'App\\Models\\User'})
    // the class is the one worth chaining on, whatever else the union allows
    expect(typeFrom('App\\Models\\User|null')).toEqual({name: 'App\\Models\\User'})
    // the first one written is the one a snippet chains on
    expect(typeFrom('App\\Models\\User|Collection<int, App\\Models\\User>')).toEqual({name: 'App\\Models\\User'})
  })

  test('a value with no members is a scalar, and an unknown one is nothing', () => {
    expect(typeFrom('int')).toEqual({scalar: 'int'})
    expect(typeFrom('string')).toEqual({scalar: 'string'})
    expect(typeFrom('array<string, int>')).toEqual({scalar: 'array'})
    expect(typeFrom('void')).toBe(null)
    expect(typeFrom('mixed')).toBe(null)
    expect(typeFrom('never')).toBe(null)
    expect(typeFrom('')).toBe(null)
    expect(typeFrom(null)).toBe(null)
  })

  test('a generic carries its item, because a collection of posts is not a collection', () => {
    expect(typeFrom('Collection<int, App\\Models\\User>')).toEqual({name: 'Collection', item: 'App\\Models\\User'})
    expect(typeFrom('Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\User>'))
      .toEqual({name: 'Illuminate\\Database\\Eloquent\\Collection', item: 'App\\Models\\User'})
  })

  test('self and the template parameters are settled on what the member was read on', () => {
    const of = {self: 'Illuminate\\Database\\Eloquent\\Builder', item: 'App\\Models\\User'}

    expect(typeFrom('$this', of)).toEqual({name: 'Illuminate\\Database\\Eloquent\\Builder'})
    expect(typeFrom('static', of)).toEqual({name: 'Illuminate\\Database\\Eloquent\\Builder'})
    expect(typeFrom('self', of)).toEqual({name: 'Illuminate\\Database\\Eloquent\\Builder'})
    expect(typeFrom('TModel', of)).toEqual({name: 'App\\Models\\User'})
    expect(typeFrom('TModel|null', of)).toEqual({name: 'App\\Models\\User'})
    // read on no model at all, the parameter has nothing to be
    expect(typeFrom('TModel')).toBe(null)
  })

  test('a type ends at the first space outside its brackets, and prose after it is not part of it', () => {
    expect(typeExpression('Collection<int, TModel>  the posts of the user')).toBe('Collection<int, TModel>')
    expect(typeExpression('  array{a: int, b: string}  ')).toBe('array{a: int, b: string}')
    expect(typeExpression('')).toBe('')
  })

  test('a conditional type answers the branch it falls back to', () => {
    // `find()` accepts an id or a list of them; a snippet writes one, and the
    // popup is drawn for that one
    expect(typeExpression('($this is TModel ? TModel : $this)')).toBe('$this')
    // read on nothing, `TModel` is nothing, and a collection with no item is still
    // a collection
    expect(typeFrom(typeExpression('(Collection<int, TModel>|TModel)'))).toEqual({name: 'Collection'})
    expect(typeFrom(typeExpression('(Collection<int, TModel>|TModel)'), {item: 'App\\Models\\User'}))
      .toEqual({name: 'Collection', item: 'App\\Models\\User'})
  })

  test('a written name is resolved against what the member was read on', () => {
    expect(resolveName('static', {self: 'App\\Models\\User'})).toBe('App\\Models\\User')
    expect(resolveName('mixed', {self: 'App\\Models\\User'})).toBe(null)
    expect(resolveName('TValue', {item: 'App\\Models\\Post'})).toBe('App\\Models\\Post')
  })
})

describe('a model column, typed', () => {
  const model = {casts: {is_admin: 'bool', price: 'decimal:2', meta: 'array'}}

  test('the database spells its types its own way, and a value answers in five kinds', () => {
    expect(attributeType(model, {name: 'id', type: 'integer'})).toEqual({scalar: 'int'})
    expect(attributeType(model, {name: 'id', type: 'bigint'})).toEqual({scalar: 'int'})
    expect(attributeType(model, {name: 'name', type: 'varchar(255)'})).toEqual({scalar: 'string'})
    expect(attributeType(model, {name: 'body', type: 'text'})).toEqual({scalar: 'string'})
    expect(attributeType(model, {name: 'seen', type: 'boolean'})).toEqual({scalar: 'bool'})
    // a date is a date, whatever the driver calls the column
    expect(attributeType(model, {name: 'created_at', type: 'timestamp'})).toEqual({name: 'Illuminate\\Support\\Carbon'})
    expect(attributeType(model, {name: 'day', type: 'date'})).toEqual({name: 'Illuminate\\Support\\Carbon'})
  })

  test('a cast says more than the column does, and wins', () => {
    expect(attributeType(model, {name: 'is_admin', type: 'tinyint(1)'})).toEqual({scalar: 'bool'})
    expect(attributeType(model, {name: 'price', type: 'decimal(8,2)'})).toEqual({scalar: 'string'})
    expect(attributeType(model, {name: 'meta', type: 'json'})).toEqual({scalar: 'array'})
    expect(attributeType(model, {name: 'notes', type: 'blob'})).toBe(null)
  })

  test('a cast is written like a call, and can name a class', () => {
    expect(castType('int')).toEqual({scalar: 'int'})
    expect(castType('datetime')).toEqual({name: 'Illuminate\\Support\\Carbon'})
    expect(castType('immutable_datetime')).toEqual({name: 'Illuminate\\Support\\CarbonImmutable'})
    expect(castType('date:Y-m-d')).toEqual({name: 'Illuminate\\Support\\Carbon'})
    expect(castType('collection')).toEqual({name: 'Illuminate\\Support\\Collection'})
    expect(castType('encrypted:array')).toEqual({scalar: 'string'})
    expect(castType('App\\Casts\\Money')).toEqual({name: 'App\\Casts\\Money'})
    expect(castType('asDateTime')).toBe(null)
    expect(castType(null)).toBe(null)
  })
})

describe('a model, as the read describes it', () => {
  const intel = {
    models: [
      {
        class: 'App\\Models\\User',
        attributes: [
          {name: 'id', type: 'integer', nullable: false},
          {name: 'email', type: 'string', nullable: false},
        ],
        casts: {},
        appends: ['avatar'],
        relations: [
          {name: 'posts', related: 'App\\Models\\Post', relation: 'HasMany', many: true},
          {name: 'team', related: 'App\\Models\\Team', relation: 'BelongsTo', many: false},
          {name: 'broken'},
        ],
        scopes: ['active', ''],
      },
    ],
    builders: {
      eloquent: [{name: 'where', params: ['string $column'], returns: '$this'}, {name: 'first', params: [], returns: 'TModel|null'}],
      query: [{name: 'select', params: ['mixed $columns'], returns: '$this'}],
    },
  }

  test('every column is typed, and an appended attribute is offered with no type', () => {
    expect(attributesOf(intel, 'App\\Models\\User')).toEqual([
      {name: 'id', type: {scalar: 'int'}, nullable: false, cast: null},
      {name: 'email', type: {scalar: 'string'}, nullable: false, cast: null},
      {name: 'avatar', type: null, nullable: null, cast: null},
    ])
    expect(attributesOf(intel, 'App\\Models\\Nope')).toEqual([])
  })

  test('a relation says what it reaches and whether there is one or many', () => {
    expect(relationsOf(intel, 'App\\Models\\User')).toEqual([
      {name: 'posts', related: 'App\\Models\\Post', many: true, relation: 'HasMany'},
      {name: 'team', related: 'App\\Models\\Team', many: false, relation: 'BelongsTo'},
    ])
    expect(scopesOf(intel, 'App\\Models\\User')).toEqual(['active'])
  })

  test('a builder method keeps the model it was read for, and the chain stays on it', () => {
    const eloquent = builderTable(intel, 'eloquent', 'App\\Models\\User')

    expect(eloquent[0]).toMatchObject({kind: 'method', name: 'where', static: false})
    expect(eloquent[0].returns).toEqual({name: 'Illuminate\\Database\\Eloquent\\Builder', item: 'App\\Models\\User'})
    expect(eloquent[1].returns).toEqual({name: 'App\\Models\\User'})
    // read on no model, the builder returns the builder and nothing else
    expect(builderTable(intel, 'eloquent', null)[0].returns).toEqual({name: 'Illuminate\\Database\\Eloquent\\Builder'})
    expect(builderTable(intel, 'query', null)[0].returns).toEqual({name: 'Illuminate\\Database\\Query\\Builder'})
    expect(builderTable(null, 'eloquent', null)).toEqual([])
  })
})
