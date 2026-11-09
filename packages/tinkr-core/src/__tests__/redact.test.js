const {
  HIDDEN,
  bindingColumns,
  defaultRedactFields,
  redactPatterns,
  redactQuery,
  redactResult,
  redactValue,
} = require('../redact')

const columns = sql => [...bindingColumns(sql)]

describe('the fields a run hides', () => {
  test('hides the names a project hands back by default, and leaves ordinary ones', () => {
    const value = {
      id: 4,
      key: 'orders',
      name: 'Ada',
      email: 'ada@example.test',
      password: 'hunter2',
      password_confirmation: 'hunter2',
      remember_token: 'Zx9',
      api_key: 'sk-live',
      client_secret: 's3cr3t',
      authorization: 'Bearer abc',
      cookie: 'session=abc',
      session_id: 'not-a-credential',
    }

    expect(redactValue(value, undefined)).toEqual({
      id: 4,
      key: 'orders',
      name: 'Ada',
      email: 'ada@example.test',
      password: HIDDEN,
      password_confirmation: HIDDEN,
      remember_token: HIDDEN,
      api_key: HIDDEN,
      client_secret: HIDDEN,
      authorization: HIDDEN,
      cookie: HIDDEN,
      session_id: 'not-a-credential',
    })
  })

  test('matches a field name whatever its case', () => {
    expect(redactValue({PASSWORD: 'x', Remember_Token: 'y'}, undefined)).toEqual({
      PASSWORD: HIDDEN,
      Remember_Token: HIDDEN,
    })
  })

  test('reads a pattern as a name with wildcards, not a regular expression', () => {
    expect(redactValue({api_key: 'x', apixkey: 'y', 'api-key': 'z'}, ['api_key'])).toEqual({
      api_key: HIDDEN,
      apixkey: 'y',
      'api-key': 'z',
    })

    expect(redactValue({a_key: 'x', b_key: 'y', key: 'z'}, ['*_key'])).toEqual({
      a_key: HIDDEN,
      b_key: HIDDEN,
      key: 'z',
    })

    expect(redactValue({token: 'x', my_token_value: 'y', tokens: 'z'}, ['*token*'])).toEqual({
      token: HIDDEN,
      my_token_value: HIDDEN,
      tokens: HIDDEN,
    })
  })

  test('is the list the person gave, and an empty one hides nothing', () => {
    const value = {password: 'x', nickname: 'Ada'}

    expect(redactValue(value, ['nickname'])).toEqual({password: 'x', nickname: HIDDEN})
    expect(redactValue(value, [])).toBe(value)
    expect(redactValue(value, '')).toBe(value)
    expect(redactValue(value, ['', '   ', null])).toBe(value)
  })

  test('keeps the list in one place, and the defaults are what an unset setting is', () => {
    expect(redactPatterns(undefined).length).toBe(defaultRedactFields.length)
    expect(redactPatterns(null).length).toBe(defaultRedactFields.length)
    expect(redactPatterns([]).length).toBe(0)
    expect(redactPatterns(' a, B \nc,,a')).toHaveLength(3)
  })

  test('hides a field at any depth, through arrays of models and fields named in a row', () => {
    const value = {
      data: [
        {id: 1, attributes: {name: 'Ada', password: 'x'}},
        {id: 2, attributes: {name: 'Grace', password: 'y'}},
      ],
      meta: {token: 't', pages: [{secret: 's'}, {name: 'ok'}]},
    }

    expect(redactValue(value, undefined)).toEqual({
      data: [
        {id: 1, attributes: {name: 'Ada', password: HIDDEN}},
        {id: 2, attributes: {name: 'Grace', password: HIDDEN}},
      ],
      meta: {token: HIDDEN, pages: [{secret: HIDDEN}, {name: 'ok'}]},
    })
  })

  test('hides a whole array or object under a name that matches', () => {
    expect(redactValue({tokens: [{id: 1}, {id: 2}], name: 'ok'}, undefined)).toEqual({
      tokens: HIDDEN,
      name: 'ok',
    })
  })

  test('never hides what the envelope says about a value, and hides its fields as usual', () => {
    const value = {
      name: 'Ada',
      password: 'hunter2',
      __tinkrClass: 'App\\Models\\User',
      __tinkrKey: 4,
      __tinkrRelations: ['tokens'],
      __tinkrClosure: {params: [], uses: ['password']},
      __tinkrMap: {password: 'hunter2', name: 'Ada'},
    }

    // a setting that names every field still keeps the class, the key and the
    // markup, because those are not fields of the value; the fields inside the
    // map are hidden like any other
    expect(redactValue(value, ['*'])).toEqual({
      name: HIDDEN,
      password: HIDDEN,
      __tinkrClass: 'App\\Models\\User',
      __tinkrKey: 4,
      __tinkrRelations: ['tokens'],
      __tinkrClosure: {params: [], uses: ['password']},
      __tinkrMap: {password: HIDDEN, name: HIDDEN},
    })
  })

  test('hands a rendered value through, because markup has no field names', () => {
    const redacted = redactResult({
      value: {
        __tinkrClass: 'App\\Mail\\Welcome',
        __tinkrHtml: '<p>your password is hunter2</p>',
        __tinkrView: 'mail.welcome',
        __tinkrData: ['password', 'name'],
      },
      blocks: [],
      queries: [],
    }, undefined)

    // markup has no field names to go by, so it is answered as the view wrote
    // it, and the names of the data it was given are names, not values
    expect(redacted.value).toEqual({
      __tinkrClass: 'App\\Mail\\Welcome',
      __tinkrHtml: '<p>your password is hunter2</p>',
      __tinkrView: 'mail.welcome',
      __tinkrData: ['password', 'name'],
    })
  })

  test('leaves values that are not objects alone', () => {
    expect(redactValue('password', undefined)).toBe('password')
    expect(redactValue(3, undefined)).toBe(3)
    expect(redactValue(null, undefined)).toBe(null)
  })
})

describe('a run envelope', () => {
  const envelope = () => ({
    value: {id: 1, password: 'hunter2'},
    blocks: [
      {line: 1, value: {id: 1, password: 'hunter2'}, error: null},
      {line: 2, value: {token: 'Zx9'}, error: null},
    ],
    error: null,
    output: 'password: hunter2',
    queries: [],
    transaction: {
      armed: true,
      changes: [{
        table: 'users',
        op: 'updated',
        key: {id: 1},
        before: {id: 1, password: 'hunter2', name: 'Ada'},
        after: {id: 1, password: 'other', name: 'Ada'},
      }],
    },
    sandbox: {sent: ['mail to ada@example.test'], channels: {mail: 1}},
  })

  test('hides the value, the same value in a block, and a dry run row diff', () => {
    const redacted = redactResult(envelope(), undefined)

    expect(redacted.value).toEqual({id: 1, password: HIDDEN})
    expect(redacted.blocks[0].value).toEqual({id: 1, password: HIDDEN})
    expect(redacted.blocks[1].value).toEqual({token: HIDDEN})
    expect(redacted.transaction.changes[0].before.password).toBe(HIDDEN)
    expect(redacted.transaction.changes[0].after.password).toBe(HIDDEN)
    expect(redacted.transaction.changes[0].key.id).toBe(1)
  })

  test('keeps what the run printed and the error, which are text', () => {
    const redacted = redactResult(envelope(), undefined)

    expect(redacted.output).toBe('password: hunter2')
    expect(redacted.error).toBe(null)
    expect(redacted.sandbox.sent).toEqual(['mail to ada@example.test'])
  })

  test('does not change the envelope it was given', () => {
    const original = envelope()

    redactResult(original, undefined)

    expect(original.value.password).toBe('hunter2')
    expect(original.blocks[0].value.password).toBe('hunter2')
  })

  test('is the envelope itself when the list is empty', () => {
    const original = envelope()

    expect(redactResult(original, [])).toBe(original)
    expect(redactResult(null, undefined)).toBe(null)
  })
})

describe('the bindings of a query', () => {
  test('pairs an insert with its column list', () => {
    expect(columns('insert into users (name, email, password) values (?, ?, ?)'))
      .toEqual([[0, 'name'], [1, 'email'], [2, 'password']])
  })

  test('pairs every row of an insert, and skips a literal', () => {
    expect(columns("insert into users (name, password) values ('A?d', ?), ('B', ?)"))
      .toEqual([[0, 'password'], [1, 'password']])
  })

  test('pairs the columns an update sets and the condition it matches', () => {
    expect(columns('update users set password = ?, name = ? where id = ?'))
      .toEqual([[0, 'password'], [1, 'name'], [2, 'id']])
  })

  test('pairs a list of placeholders with the one column they were given for', () => {
    expect(columns('select * from users where id in (?, ?, ?) and token = ?'))
      .toEqual([[3, 'token'], [0, 'id'], [1, 'id'], [2, 'id']])
  })

  test('pairs a function call holding one placeholder, and skips one holding several', () => {
    expect(columns('insert into users (email, password) values (lower(?), ?)'))
      .toEqual([[0, 'email'], [1, 'password']])
    expect(columns('insert into users (name, password) values (concat(?, ?), ?)'))
      .toEqual([[2, 'password']])
  })

  test('pairs nothing it cannot name, and nothing inside a literal', () => {
    expect(columns('select * from users where ? = ? and note = \'password = ?\''))
      .toEqual([])
    expect(columns('select * from users limit ?')).toEqual([])
  })

  test('hides the binding of a hidden column and keeps the others', () => {
    const query = {line: 3, sql: 'update users set password = ?, name = ? where id = ?', bindings: ['hunter2', 'Ada', 1], time: 1, connection: 'mysql'}

    expect(redactQuery(query, undefined).bindings).toEqual([HIDDEN, 'Ada', 1])
    expect(redactQuery(query, undefined).sql).toBe(query.sql)
    expect(redactQuery(query, []).bindings).toEqual(['hunter2', 'Ada', 1])
  })

  test('hides a binding in an insert and in an in list', () => {
    const insert = {sql: 'insert into users (name, password) values (?, ?)', bindings: ['Ada', 'hunter2']}
    const listed = {sql: 'select * from users where token in (?, ?)', bindings: ['a', 'b']}

    expect(redactQuery(insert, undefined).bindings).toEqual(['Ada', HIDDEN])
    expect(redactQuery(listed, undefined).bindings).toEqual([HIDDEN, HIDDEN])
  })

  test('leaves a query without bindings as it is', () => {
    const query = {sql: 'select 1', bindings: []}

    expect(redactQuery(query, undefined)).toBe(query)
  })

  test('is carried through a run envelope', () => {
    const redacted = redactResult({
      value: 1,
      blocks: [],
      queries: [{sql: 'update users set password = ? where id = ?', bindings: ['x', 1]}],
    }, undefined)

    expect(redacted.queries[0].bindings).toEqual([HIDDEN, 1])
  })
})
