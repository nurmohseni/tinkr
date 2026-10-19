const fs = require('fs')
const path = require('path')

const {makeAppDir, removeAppDir, connection} = require('../__fixtures__/app')
const app = require('../app')

describe('the app\'s own files', () => {
  let dir

  afterEach(() => {
    if (dir) {
      removeAppDir(dir)
      dir = null
    }
  })

  test('reads the connections the app lists, without the quick connection', () => {
    dir = makeAppDir({
      connections: {
        one: connection({id: 'one', name: 'One'}),
        two: connection({id: 'two', name: 'Two', is_over_ssh: true, ssh_server: 'example.com'}),
      },
    })

    const found = app.connections(dir)

    expect(found.map(one => one.id).sort()).toEqual(['one', 'two'])
  })

  test('reads the command a session is started with, and answers with the app\'s own default', () => {
    const withPreference = makeAppDir({command: 'php artisan tinker --execute'})
    const withoutPreference = makeAppDir()

    expect(app.command(withPreference)).toBe('php artisan tinker --execute')
    // what tinkr-main/src/database/config.js ships as its default
    expect(app.command(withoutPreference)).toBe('php artisan tinker')

    removeAppDir(withPreference)
    removeAppDir(withoutPreference)
  })

  test('finds the app\'s data by the directory it is given', () => {
    dir = makeAppDir()

    expect(app.find(dir)).toBe(dir)
    expect(app.find('/nowhere/at/all')).toBe(null)
  })

  test('reads the snippets of a connection', () => {
    dir = makeAppDir({
      snippets: {
        one: {abc: {id: 'abc', code: '$n = 1;', name: 'One', position: {lineNumber: 1, column: 1}}},
      },
    })

    expect(app.snippets(dir, 'one')).toEqual([
      {id: 'abc', code: '$n = 1;', name: 'One', position: {lineNumber: 1, column: 1}},
    ])
    expect(app.snippets(dir, 'nothing')).toEqual([])
  })

  test('keeps a snippet beside the ones the connection already has', () => {
    dir = makeAppDir({
      snippets: {
        one: {abc: {id: 'abc', code: '$n = 1;', name: 'One', position: {lineNumber: 3, column: 8}}},
      },
    })

    const saved = app.saveSnippet(dir, 'one', 'Two', '$n = 2;')
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'app', 'snippets', 'one.json'), 'utf8'))

    // the file the app reads back: every snippet in it, and the one just kept
    expect(Object.keys(file).sort()).toEqual([saved.id, 'abc'].sort())
    expect(file[saved.id]).toEqual({
      // the app's own id for a snippet is nanoid's, and this is its shape
      id: expect.stringMatching(/^[A-Za-z0-9_-]{21}$/),
      code: '$n = 2;',
      name: 'Two',
      position: {lineNumber: 1, column: 1},
    })
    expect(file.abc).toEqual({id: 'abc', code: '$n = 1;', name: 'One', position: {lineNumber: 3, column: 8}})
  })

  test('writes the file the way the app writes it', () => {
    dir = makeAppDir()

    app.saveSnippet(dir, 'one', 'Two', '$n = 2;')

    expect(fs.readFileSync(path.join(dir, 'app', 'snippets', 'one.json'), 'utf8')).toMatch(/\n\t"/)
  })

  test('deletes one snippet and keeps the others', () => {
    dir = makeAppDir({
      snippets: {
        one: {
          abc: {id: 'abc', code: '$n = 1;', name: 'One'},
          def: {id: 'def', code: '$n = 2;', name: 'Two'},
        },
      },
    })

    expect(app.deleteSnippet(dir, 'one', 'abc')).toEqual({id: 'abc', name: 'One', deleted: true})
    expect(app.snippets(dir, 'one')).toEqual([{id: 'def', code: '$n = 2;', name: 'Two'}])
  })

  // a delete asked for twice is still a delete that happened: it says the
  // snippet was already gone rather than failing, and it deletes nothing else
  test('deleting what is not there says so and changes nothing', () => {
    dir = makeAppDir({
      snippets: {one: {abc: {id: 'abc', code: '$n = 1;', name: 'One'}}},
    })

    expect(app.deleteSnippet(dir, 'one', 'missing')).toEqual({id: 'missing', name: null, deleted: false})
    expect(app.snippets(dir, 'one')).toHaveLength(1)
  })
})
