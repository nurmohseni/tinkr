const fs = require('fs')
const os = require('os')
const path = require('path')

const {files, parse, read, dirOf} = require('../services/logs')

const line = (at, environment, level, rest) => `[${at}] ${environment}.${level}: ${rest}`

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
