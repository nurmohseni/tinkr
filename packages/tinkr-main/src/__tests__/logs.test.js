jest.mock('child_process', () => ({spawn: jest.fn()}))

const fs = require('fs')
const os = require('os')
const path = require('path')
const {EventEmitter} = require('events')
const {spawn} = require('child_process')

const {files, parse, read, dirOf} = require('../services/logs')

const line = (at, environment, level, rest) => `[${at}] ${environment}.${level}: ${rest}`

// what a command run on a connection's machine answers with: a child says what
// it was going to say once the listeners are on it, which is when a real one says
// it too
const answering = (out, code = 0, err = '') => {
  const child = new EventEmitter()

  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = jest.fn()

  process.nextTick(() => {
    if (out) {
      child.stdout.emit('data', out)
    }

    if (err) {
      child.stderr.emit('data', err)
    }

    child.emit('close', code)
  })

  return child
}

describe('what the lines of a log are', () => {
  test('is one entry per header, with the environment and the level of it', () => {
    const entries = parse([
      line('2026-08-27 11:10:52', 'testing', 'INFO', 'Discount migration complete: 0 migrated, 0 skipped.'),
      line('2026-08-27 11:10:53', 'production', 'ERROR', 'No certificate found'),
    ])

    expect(entries).toEqual([
      {
        at: '2026-08-27 11:10:52',
        environment: 'testing',
        level: 'info',
        message: 'Discount migration complete: 0 migrated, 0 skipped.',
        details: '',
      },
      {
        at: '2026-08-27 11:10:53',
        environment: 'production',
        level: 'error',
        message: 'No certificate found',
        details: '',
      },
    ])
  })

  test('keeps the json context a formatter appended as details, not as the message', () => {
    const [entry] = parse([
      line('2026-08-27 11:10:53', 'testing', 'ERROR', 'No certificate found {"exception":"[object] (InvalidArgumentException(code: 0): No certificate found at /app/PassGenerator.php:104)"}'),
    ])

    expect(entry.message).toBe('No certificate found')
    expect(entry.details).toContain('"exception"')
    expect(entry.details).toContain('PassGenerator.php')
  })

  test('gives a line that starts nothing to the entry above it', () => {
    const entries = parse([
      line('2026-08-27 11:10:53', 'testing', 'ERROR', 'It broke {"exception":"..."}'),
      '[stacktrace]',
      '#0 /app/Models/Abonado.php(1905): Thenextweb\\PassGenerator->__construct(1)',
      '',
      line('2026-08-27 11:11:01', 'testing', 'INFO', 'and then it did not'),
    ])

    expect(entries).toHaveLength(2)
    expect(entries[0].details.split('\n').slice(0, 3)).toEqual([
      '{"exception":"..."}',
      '[stacktrace]',
      '#0 /app/Models/Abonado.php(1905): Thenextweb\\PassGenerator->__construct(1)',
    ])
    expect(entries[1].message).toBe('and then it did not')
  })

  test('shows a line that starts nothing and belongs to nothing as it is', () => {
    const entries = parse(['a log file that is not laravel\'s', line('2026-08-27 11:10:52', 'local', 'DEBUG', 'and then one that is')])

    expect(entries[0]).toEqual({
      at: null,
      environment: null,
      level: null,
      message: 'a log file that is not laravel\'s',
      details: '',
    })
    expect(entries[1].level).toBe('debug')
  })

  test('says nothing about a file that says nothing', () => {
    expect(parse([])).toEqual([])
  })
})

describe('the log files of a connection', () => {
  const project = names => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-logs-'))

    fs.mkdirSync(path.join(root, 'storage', 'logs'), {recursive: true})

    for (const name of names) {
      fs.writeFileSync(path.join(root, 'storage', 'logs', name), line('2026-08-27 11:10:52', 'local', 'INFO', name))
    }

    return root
  }

  test('are where laravel puts them, newest first', () => {
    const root = project(['laravel.log', 'evo-2026-10-07.log', 'paycomet-2026-09-18.log', '.gitignore'])
    const logs = path.join(root, 'storage', 'logs')

    // a test writes them all in the same millisecond, and the newest file is the
    // one the picker opens on
    fs.utimesSync(path.join(logs, 'laravel.log'), new Date(1000), new Date(1000))
    fs.utimesSync(path.join(logs, 'paycomet-2026-09-18.log'), new Date(2000), new Date(2000))
    fs.utimesSync(path.join(logs, 'evo-2026-10-07.log'), new Date(3000), new Date(3000))

    const {dir, files: found} = files({path: root, is_over_ssh: false})

    expect(dir).toBe(path.join(root, 'storage', 'logs'))
    expect(found.map(one => one.name)).toEqual(['evo-2026-10-07.log', 'paycomet-2026-09-18.log', 'laravel.log'])
    expect(found.every(one => one.size > 0 && one.at > 0)).toBe(true)
  })

  test('are none when the project keeps none', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-nologs-'))

    expect(files({path: root, is_over_ssh: false})).toEqual({
      dir: path.join(root, 'storage', 'logs'),
      files: [],
    })
  })

  test('are read from the end, where the newest entries are', () => {
    const root = project(['laravel.log'])
    const connection = {path: root, is_over_ssh: false}

    expect(dirOf(connection)).toBe(path.join(root, 'storage', 'logs'))

    const answer = read(connection, 'laravel.log')

    expect(answer.file).toBe('laravel.log')
    expect(answer.read).toBe(answer.size)
    expect(answer.entries).toHaveLength(1)
    expect(answer.entries[0].message).toBe('laravel.log')
  })

  test('are read as a tail, with the half-read line at the front dropped', () => {
    const root = project([])
    const file = path.join(root, 'storage', 'logs', 'big.log')
    const many = Array.from({length: 400}, (unused, at) => line('2026-08-27 11:10:52', 'local', 'INFO', `entry ${at} `.padEnd(60, '.')))

    fs.writeFileSync(file, many.join('\n'))

    const connection = {path: root, is_over_ssh: false}
    const answer = read(connection, 'big.log', 2048)

    expect(answer.size).toBeGreaterThan(2048)
    expect(answer.read).toBe(2048)
    expect(answer.entries.every(entry => entry.message.startsWith('entry '))).toBe(true)
    expect(answer.entries.length).toBeLessThan(400)
    expect(answer.entries[answer.entries.length - 1].message.startsWith('entry 399')).toBe(true)
  })

  test('cannot be read by a name that is a path', () => {
    const root = project(['laravel.log'])
    const connection = {path: root, is_over_ssh: false}

    expect(() => read(connection, '../storage/logs/laravel.log')).toThrow(/is not a log file/)
    expect(() => read(connection, '/etc/passwd')).toThrow(/is not a log file/)
    expect(() => read(connection, 'gone.log')).toThrow(/is not there any more/)
  })

  test('keep a name a project writes, and read nothing else', () => {
    const root = project(['evo-2026-10-07.log'])

    // the name may be a connection's own file, and not a path to another one
    expect(read({path: root, is_over_ssh: false}, 'evo-2026-10-07.log').size).toBeGreaterThan(0)
  })
})

describe('the log files of a connection that keeps them on another machine', () => {
  const connection = {
    path: '/var/www/app',
    is_over_ssh: true,
    ssh_server: '192.168.1.1',
    ssh_user: 'root',
  }

  beforeEach(() => spawn.mockReset())

  test('are listed by that machine, in the shape the picker reads', async () => {
    spawn.mockImplementation(() => answering('laravel.log\t1024\t1000\nevo-2026-10-07.log\t2048\t3000\n'))

    const {dir, files: found} = await files(connection)

    expect(dir).toBe('/var/www/app/storage/logs')
    expect(found).toEqual([
      {name: 'evo-2026-10-07.log', size: 2048, at: 3000},
      {name: 'laravel.log', size: 1024, at: 1000},
    ])

    const [command, args] = spawn.mock.calls[0]

    expect(command).toBe('ssh')
    expect(args).toContain('root@192.168.1.1')
    expect(args[args.length - 1]).toContain("cd '/var/www/app' && php -r")
  })

  test('are none when the machine has none there', async () => {
    spawn.mockImplementation(() => answering(''))

    expect(await files(connection)).toEqual({dir: '/var/www/app/storage/logs', files: []})
  })

  test('are none when the machine does not answer', async () => {
    spawn.mockImplementation(() => answering('', 255, 'Permission denied (publickey).'))

    expect(await files(connection)).toEqual({dir: '/var/www/app/storage/logs', files: []})
  })

  test('are read from the end, as the local ones are', async () => {
    const text = `${line('2026-08-27 11:10:52', 'local', 'INFO', 'laravel.log')}\n`

    spawn.mockImplementation(() => answering(JSON.stringify({size: Buffer.byteLength(text), text})))

    expect(await read(connection, 'laravel.log')).toEqual({
      file: 'laravel.log',
      size: Buffer.byteLength(text),
      read: Buffer.byteLength(text),
      entries: [
        {
          at: '2026-08-27 11:10:52',
          environment: 'local',
          level: 'info',
          message: 'laravel.log',
          details: '',
        },
      ],
    })
  })

  test('are read as a tail, with the half-read line at the front dropped', async () => {
    const many = Array.from({length: 400}, (unused, at) => line('2026-08-27 11:10:52', 'local', 'INFO', `entry ${at} `.padEnd(60, '.')))
    const whole = many.join('\n')

    spawn.mockImplementation(() => answering(JSON.stringify({size: Buffer.byteLength(whole), text: whole.slice(-2048)})))

    const answer = await read(connection, 'big.log', 2048)

    expect(answer.size).toBe(Buffer.byteLength(whole))
    expect(answer.read).toBe(2048)
    expect(answer.entries.every(entry => entry.message.startsWith('entry '))).toBe(true)
    expect(answer.entries.length).toBeLessThan(400)
    expect(answer.entries[answer.entries.length - 1].message.startsWith('entry 399')).toBe(true)
  })

  test('cannot be read by a name that is a path, over ssh either', () => {
    expect(() => read(connection, '../storage/logs/laravel.log')).toThrow(/is not a log file/)
  })

  test('are gone when the machine says the file is not there', async () => {
    spawn.mockImplementation(() => answering('', 1))

    await expect(read(connection, 'gone.log')).rejects.toThrow(/is not there any more/)
  })

  test('are gone when the machine answers with something that is not a log', async () => {
    spawn.mockImplementation(() => answering('php: command not found'))

    await expect(read(connection, 'gone.log')).rejects.toThrow(/is not there any more/)
  })
})
