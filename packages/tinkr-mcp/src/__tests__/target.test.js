const path = require('path')

const {makeAppDir, removeAppDir, connection} = require('../__fixtures__/app')
const target = require('../target')

describe('what code runs in', () => {
  let dir

  afterEach(() => {
    if (dir) {
      removeAppDir(dir)
      dir = null
    }
  })

  const appDir = () => {
    dir = makeAppDir({
      command: 'php artisan tinker',
      connections: {
        one: connection({id: 'one', name: 'The App', path: '/tmp/project'}),
        production: connection({
          id: 'production',
          name: 'Production',
          is_over_ssh: true,
          ssh_server: 'example.com',
          ssh_user: 'deploy',
          path: '/srv/app',
        }),
      },
    })

    return dir
  }

  test('takes the connection a name points at, by id or by name', () => {
    const dataDir = appDir()

    expect(target.resolve({connection: 'one', dataDir}).connection.id).toBe('one')
    expect(target.resolve({connection: 'The App', dataDir}).connection.path).toBe('/tmp/project')
    expect(target.resolve({connection: 'the app', dataDir}).connection.name).toBe('The App')
    expect(target.resolve({connection: 'production', dataDir}).connection.is_over_ssh).toBe(true)
  })

  test('says what it knows when a connection is not one of them', () => {
    const dataDir = appDir()

    expect(() => target.resolve({connection: 'nope', dataDir})).toThrow(/no connection "nope"/)
    expect(() => target.resolve({connection: 'nope', dataDir})).toThrow(/one \(The App\)/)
  })

  test('takes the app\'s own connection for the directory it is started in', () => {
    const dataDir = appDir()
    const found = target.resolve({at: '/tmp/project/', dataDir})

    // the app's connection, not a copy of it: a run's snippets and history are
    // that connection's
    expect(found.connection.id).toBe('one')
    expect(found.saved).toBe(true)
  })

  test('is the directory itself when the app has no connection for it', () => {
    const dataDir = appDir()
    const found = target.resolve({at: '/tmp/elsewhere', dataDir})

    expect(found.saved).toBe(false)
    expect(found.connection).toEqual({
      id: 'cwd',
      name: 'elsewhere',
      path: path.resolve('/tmp/elsewhere'),
      command: 'php artisan tinker',
      is_over_ssh: false,
    })
  })

  test('runs the command it is given, over whatever the connection says', () => {
    const dataDir = appDir()

    expect(target.resolve({connection: 'one', command: 'php artisan tinker --execute', dataDir})
      .connection.command).toBe('php artisan tinker --execute')
    expect(target.resolve({at: '/tmp/elsewhere', command: 'php artisan tinker --execute', dataDir})
      .connection.command).toBe('php artisan tinker --execute')
  })

  test('does not match a directory to a connection that runs it over ssh', () => {
    const dataDir = makeAppDir({
      connections: {production: connection({id: 'production', is_over_ssh: true, path: '/tmp/project'})},
    })

    expect(target.resolve({at: '/tmp/project', dataDir}).saved).toBe(false)
  })

  test('runs in the directory it was started in when nothing says otherwise', () => {
    const found = target.resolve({dataDir: '/nowhere'})

    expect(found.connection.path).toBe(process.cwd())
    expect(found.saved).toBe(false)
    expect(found.dataDir).toBe(null)
  })
})
