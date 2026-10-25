jest.mock('child_process', () => ({spawn: jest.fn()}))

const fs = require('fs')
const os = require('os')
const path = require('path')
const {EventEmitter} = require('events')
const {spawn} = require('child_process')

const {files, parse, read, dirOf, stampOf} = require('../logs')

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
    const answer = read(connection, 'big.log', {bytes: 2048})

    expect(answer.size).toBeGreaterThan(2048)
    expect(answer.read).toBe(2048)
    expect(answer.from).toBe(answer.size - 2048)
    expect(answer.entries.every(entry => entry.message.startsWith('entry '))).toBe(true)
    expect(answer.entries.length).toBeLessThan(400)
    expect(answer.entries[answer.entries.length - 1].message.startsWith('entry 399')).toBe(true)
  })

  test('are read a window at a time, ending where the reader asks and not always at the end', () => {
    const root = project([])
    const file = path.join(root, 'storage', 'logs', 'big.log')
    const many = Array.from({length: 400}, (unused, at) => line('2026-08-27 11:10:52', 'local', 'INFO', `entry ${at} `.padEnd(60, '.')))
    const whole = many.join('\n')

    fs.writeFileSync(file, whole)

    const connection = {path: root, is_over_ssh: false}
    // a window of 2048 bytes ending at 4096, which is a byte in the middle of a
    // line: the window starts at 2048, and the line it lands in is dropped
    const answer = read(connection, 'big.log', {bytes: 2048, before: 4096})

    expect(answer.size).toBe(Buffer.byteLength(whole))
    expect(answer.from).toBe(2048)
    expect(answer.read).toBe(2048)
    // what is shown starts at the first whole line of the window
    expect(answer.entries[0].message).toBe('entry 22 '.padEnd(60, '.'))
    // and ends at the last one before the byte it ends in, what was read of that
    // line hanging off the entry above it
    expect(answer.entries[answer.entries.length - 1].message).toBe('entry 42 '.padEnd(60, '.'))
    expect(answer.entries[answer.entries.length - 1].details).toBe(whole.slice(4085, 4096))
    expect(answer.entries.length).toBeLessThan(400)
  })

  test('are read forward from a byte too, which is how the viewer walks back down', () => {
    const root = project([])
    const file = path.join(root, 'storage', 'logs', 'big.log')
    const many = Array.from({length: 400}, (unused, at) => line('2026-08-27 11:10:52', 'local', 'INFO', `entry ${at} `.padEnd(60, '.')))
    const whole = many.join('\n')

    fs.writeFileSync(file, whole)

    const connection = {path: root, is_over_ssh: false}
    const answer = read(connection, 'big.log', {bytes: 2048, after: 2048})

    expect(answer.from).toBe(2048)
    expect(answer.read).toBe(2048)
    expect(answer.entries[0].message).toBe('entry 22 '.padEnd(60, '.'))
    expect(answer.entries[answer.entries.length - 1].message.startsWith('entry 4')).toBe(true)
  })

  test('cannot be read by a name that is a path', () => {
    const root = project(['laravel.log'])
    const connection = {path: root, is_over_ssh: false}

    expect(() => read(connection, '../storage/logs/laravel.log')).toThrow(/is not a log file/)
    expect(() => read(connection, '/etc/passwd')).toThrow(/is not a log file/)
    expect(() => read(connection, 'gone.log')).toThrow(/is not there any more/)
    // a window onto a file that is not a log of this connection is no window either
    expect(() => read(connection, '/etc/passwd', {bytes: 2048, before: 4096})).toThrow(/is not a log file/)
  })

  test('keep a name a project writes, and read nothing else', () => {
    const root = project(['evo-2026-10-07.log'])

    // the name may be a connection's own file, and not a path to another one
    expect(read({path: root, is_over_ssh: false}, 'evo-2026-10-07.log').size).toBeGreaterThan(0)
  })
})

describe('a range of moments in a log', () => {
  let root = ''

  // a day of entries, two an hour, so a range is a slice of a file far longer
  // than any one window onto it
  const day = () => {
    const lines = []

    for (let hour = 0; hour < 24; hour++) {
      for (const minute of ['00', '30']) {
        const at = `2026-08-27 ${String(hour).padStart(2, '0')}:${minute}:00`

        lines.push(line(at, 'production', 'INFO', `the ${hour}:${minute} event`.padEnd(40, '.')))
      }
    }

    return lines.join('\n') + '\n'
  }

  const write = text => {
    const file = path.join(root, 'storage', 'logs', 'laravel.log')

    fs.writeFileSync(file, text)

    return file
  }

  const local = () => ({path: root, is_over_ssh: false})

  beforeEach(() => {
    spawn.mockReset()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-range-'))
    // the service looks in <path>/storage/logs, so the file goes where it looks
    fs.mkdirSync(path.join(root, 'storage', 'logs'), {recursive: true})
  })

  afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

  test('starts where the first entry at or after it was written', async () => {
    write(day())

    const answer = await read(local(), 'laravel.log', {bytes: 4096, since: '2026-08-27 06:00:00'})

    expect(answer.entries[0].message.startsWith('the 6:00 event')).toBe(true)
    expect(answer.entries.every(one => one.at >= '2026-08-27 06:00:00')).toBe(true)
  })

  test('is found in the file, not in the window that happens to be loaded', async () => {
    const text = day()

    write(text)

    // a window far smaller than the file, so nothing of the morning is in memory
    const answer = await read(local(), 'laravel.log', {bytes: 1024, since: '2026-08-27 03:00:00', until: '2026-08-27 03:30:00'})

    expect(answer.read).toBeLessThan(Buffer.byteLength(text))
    expect(answer.entries.length).toBeGreaterThan(0)
    expect(answer.entries.every(one => one.at >= '2026-08-27 03:00:00' && one.at <= '2026-08-27 03:30:00')).toBe(true)
    expect(answer.range.from).toBeLessThan(answer.range.to)
  })

  test('stops before the first entry past its end', async () => {
    write(day())

    const answer = await read(local(), 'laravel.log', {bytes: 4096, since: '2026-08-27 03:00:00', until: '2026-08-27 03:30:00'})

    expect(answer.entries.map(one => one.at)).toEqual(['2026-08-27 03:00:00', '2026-08-27 03:30:00'])
  })

  test('is open-ended at the end, which is where the file ends', async () => {
    write(day())

    const answer = await read(local(), 'laravel.log', {bytes: 8192, since: '2026-08-27 23:00:00'})

    expect(answer.entries.map(one => one.at)).toEqual(['2026-08-27 23:00:00', '2026-08-27 23:30:00'])
    expect(answer.range.to).toBe(answer.size)
  })

  test('is open-ended at the start, which is where the file begins', async () => {
    write(day())

    const answer = await read(local(), 'laravel.log', {bytes: 4096, until: '2026-08-27 00:30:00'})

    expect(answer.range.from).toBe(0)
    expect(answer.entries[0].at).toBe('2026-08-27 00:00:00')
  })

  test('answers with nothing when the range is past the file', async () => {
    write(day())

    const answer = await read(local(), 'laravel.log', {bytes: 4096, since: '2026-08-28 00:00:00'})

    expect(answer.entries).toEqual([])
  })

  test('is not fooled by a continuation line that starts with a bracket', async () => {
    // laravel writes the stack trace under an entry, and a frame line can begin
    // with a bracket. Read as a header, `[stacktrace]` is a stamp of
    // `stacktrace]` that sorts after every range and ends the scan at once, so
    // the range answers with nothing at all.
    write([
      line('2026-08-27 10:00:00', 'production', 'ERROR', 'first'),
      '[stacktrace]',
      '#0 /app/a.php(1): go()',
      line('2026-08-27 11:00:00', 'production', 'INFO', 'second'),
      line('2026-08-27 12:00:00', 'production', 'INFO', 'third'),
    ].join('\n'))

    const answer = await read(local(), 'laravel.log', {bytes: 4096, since: '2026-08-27 11:00:00'})

    expect(answer.entries[0].message).toBe('second')
    expect(answer.entries.map(one => one.at)).toEqual(['2026-08-27 11:00:00', '2026-08-27 12:00:00'])
  })

  test('stamps a header only, so a bracketed detail is not read as a moment', () => {
    expect(stampOf('[stacktrace]')).toBe(null)
    expect(stampOf('[2026-08-27 11:10:52] production.INFO: hi')).toBe('2026-08-27 11:10:52')
  })

  test('is read from the json formatter\'s own stamp too', async () => {
    write('{"message":"json one","level":400,"level_name":"ERROR","channel":"local","datetime":"2026-08-27T05:30:00.000000+00:00"}\n' +
      '{"message":"json two","level":200,"level_name":"INFO","channel":"local","datetime":"2026-08-27T09:30:00.000000+00:00"}\n')

    const answer = await read(local(), 'laravel.log', {bytes: 4096, since: '2026-08-27 06:00:00'})

    expect(answer.entries.map(one => one.message)).toEqual(['json two'])
  })

  test('keeps the entry a window starts on when the window begins the range itself', async () => {
    write(day())

    // a window wide enough to reach back to the range's own start begins on a
    // line the seek found, so that line is whole and is not dropped as a tail's is
    const answer = await read(local(), 'laravel.log', {bytes: 4096, since: '2026-08-27 12:00:00'})

    expect(answer.from).toBe(answer.range.from)
    expect(answer.entries[0].message.startsWith('the 12:00 event')).toBe(true)
  })

  test('drops the half-read line when its window starts inside the range', async () => {
    write(day())

    // 1024 bytes does not reach back to noon, so the window begins mid-line and
    // that fragment belongs to no entry
    const answer = await read(local(), 'laravel.log', {bytes: 1024, since: '2026-08-27 12:00:00'})

    expect(answer.from).toBeGreaterThan(answer.range.from)
    expect(answer.entries.every(one => one.message.startsWith('the '))).toBe(true)
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

    // the last child is the command itself: the connection's login is a child
    // of its own (see remote.ensureMaster)
    const [command, args] = spawn.mock.calls[spawn.mock.calls.length - 1]

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

    spawn.mockImplementation(() => answering(JSON.stringify({
      size: Buffer.byteLength(text), from: 0, to: Buffer.byteLength(text), start: 0, text,
    })))

    expect(await read(connection, 'laravel.log')).toEqual({
      file: 'laravel.log',
      size: Buffer.byteLength(text),
      read: Buffer.byteLength(text),
      from: 0,
      range: {from: 0, to: Buffer.byteLength(text)},
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

    const start = Buffer.byteLength(whole) - 2048

    spawn.mockImplementation(() => answering(JSON.stringify({
      size: Buffer.byteLength(whole), from: 0, to: Buffer.byteLength(whole), start, text: whole.slice(-2048),
    })))

    const answer = await read(connection, 'big.log', {bytes: 2048})

    expect(answer.size).toBe(Buffer.byteLength(whole))
    expect(answer.read).toBe(2048)
    expect(answer.from).toBe(Buffer.byteLength(whole) - 2048)
    expect(answer.entries.every(entry => entry.message.startsWith('entry '))).toBe(true)
    expect(answer.entries.length).toBeLessThan(400)
    expect(answer.entries[answer.entries.length - 1].message.startsWith('entry 399')).toBe(true)
  })

  test('are asked for as a window, so the other machine reads only those bytes', async () => {
    const many = Array.from({length: 400}, (unused, at) => line('2026-08-27 11:10:52', 'local', 'INFO', `entry ${at} `.padEnd(60, '.')))
    const whole = many.join('\n')

    spawn.mockImplementation(() => answering(JSON.stringify({
      size: Buffer.byteLength(whole), from: 0, to: Buffer.byteLength(whole), start: 2048, text: whole.slice(2048, 4096),
    })))

    const answer = await read(connection, 'big.log', {bytes: 2048, before: 4096})

    expect(answer.size).toBe(Buffer.byteLength(whole))
    expect(answer.from).toBe(2048)
    expect(answer.read).toBe(2048)
    expect(answer.entries[0].message).toBe('entry 22 '.padEnd(60, '.'))

    // the last child is the command itself: the connection's login is a child
    // of its own (see remote.ensureMaster)
    const [command, args] = spawn.mock.calls[spawn.mock.calls.length - 1]

    expect(command).toBe('ssh')
    expect(args[args.length - 1]).toContain('$end=$after===null?min(4096,$to):min($start+2048,$to);')
    expect(args[args.length - 1]).toContain('stream_get_contents($h,$end-$start)')
  })

  test('are asked for forward from a byte as well', async () => {
    const many = Array.from({length: 400}, (unused, at) => line('2026-08-27 11:10:52', 'local', 'INFO', `entry ${at} `.padEnd(60, '.')))
    const whole = many.join('\n')

    spawn.mockImplementation(() => answering(JSON.stringify({
      size: Buffer.byteLength(whole), from: 0, to: Buffer.byteLength(whole), start: 2048, text: whole.slice(2048, 4096),
    })))

    const answer = await read(connection, 'big.log', {bytes: 2048, after: 2048})

    expect(answer.from).toBe(2048)
    expect(answer.read).toBe(2048)

    // the last child is the command itself: the connection's login is a child
    // of its own (see remote.ensureMaster)
    const [command, args] = spawn.mock.calls[spawn.mock.calls.length - 1]

    expect(command).toBe('ssh')
    expect(args[args.length - 1]).toContain('$after=2048;')
    expect(args[args.length - 1]).toContain('$end=$after===null?min($n,$to):min($start+2048,$to);')
  })

  test('are scanned for a level in two questions: the size and range, then the matches', async () => {
    const whole = [
      line('2026-08-27 10:00:00', 'production', 'ERROR', 'first'),
      line('2026-08-27 11:00:00', 'production', 'INFO', 'the job ran'),
      line('2026-08-27 12:00:00', 'production', 'ERROR', 'second'),
    ].join('\n') + '\n'

    const answers = [
      // what the window answers: where the file's range sits, nothing of its text
      JSON.stringify({size: Buffer.byteLength(whole), from: 0, to: Buffer.byteLength(whole), start: 0, text: ''}),
      // and what the scan answers: the matches, newest last, and what was older
      JSON.stringify({
        size: Buffer.byteLength(whole),
        entries: [{at: '2026-08-27 12:00:00', environment: 'production', level: 'error', message: 'second', details: ''}],
        older: 1,
      }),
    ]

    spawn.mockImplementation((command, args = []) => {
      // the login the command travels down is asked about first, and made when
      // the socket is free: neither is one of the two questions this is about
      if (args.includes('-O')) {
        return answering('', 1)
      }

      if (args.includes('-f')) {
        return answering('')
      }

      const question = args[args.length - 1] || ''

      return answering(question.includes('$tinkr_levels') ? answers[1] : answers[0])
    })

    const answer = await read(connection, 'laravel.log', {level: 'error', limit: 1})

    expect(answer.size).toBe(Buffer.byteLength(whole))
    expect(answer.entries.map(one => one.message)).toEqual(['second'])
    expect(answer.older).toBe(1)

    // the first question is the window that finds the range, and the second is
    // the scan of it: one round trip each, and the file itself never crosses
    const questions = spawn.mock.calls
      .map(([, args]) => args[args.length - 1])
      .filter(one => one.includes('php -r'))

    expect(questions).toHaveLength(2)
    expect(questions[0]).toContain('stream_get_contents')

    expect(questions[1]).toContain('$tinkr_levels=array(')
    expect(questions[1]).toContain('$tinkr_limit=1;')
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

describe('a filtered read of a log', () => {
  let root = ''

  const write = lines => {
    fs.writeFileSync(
      path.join(root, 'storage', 'logs', 'laravel.log'),
      lines.length ? `${lines.join('\n')}\n` : '',
    )
  }

  const local = () => ({path: root, is_over_ssh: false})

  const entries = () => [
    line('2026-08-27 10:00:00', 'production', 'ERROR', 'No certificate found'),
    '[stacktrace]',
    '#0 /app/a.php(1): go()',
    line('2026-08-27 11:00:00', 'production', 'INFO', 'the job ran'),
    line('2026-08-27 11:30:00', 'production', 'WARNING', 'slow query'),
    line('2026-08-27 12:00:00', 'production', 'ERROR', 'No certificate found again'),
  ]

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-filter-'))
    fs.mkdirSync(path.join(root, 'storage', 'logs'), {recursive: true})
  })

  afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

  test('answers with the entries of a level, and the lines that belong to them', async () => {
    write(entries())

    const answer = await read(local(), 'laravel.log', {level: 'error'})

    expect(answer.filtered).toBeUndefined()
    expect(answer.entries.map(one => one.message)).toEqual(['No certificate found', 'No certificate found again'])
    expect(answer.entries[0].details).toContain('#0 /app/a.php(1): go()')
    expect(answer.older).toBe(0)
    expect(answer.from).toBe(0)
    expect(answer.to).toBe(Buffer.byteLength(entries().join('\n') + '\n'))
  })

  test('answers with a level given as a list, and in any case', async () => {
    write(entries())

    const answer = await read(local(), 'laravel.log', {level: ['ERROR', 'warning']})

    expect(answer.entries.map(one => one.level)).toEqual(['error', 'warning', 'error'])
  })

  test('finds a term anywhere in an entry, without case', async () => {
    write(entries())

    const answer = await read(local(), 'laravel.log', {term: 'JOB RAN'})

    expect(answer.entries.map(one => one.message)).toEqual(['the job ran'])
  })

  test('keeps the newest matches and says how many older ones there were', async () => {
    write(entries())

    const answer = await read(local(), 'laravel.log', {level: 'error', limit: 1})

    expect(answer.entries.map(one => one.message)).toEqual(['No certificate found again'])
    expect(answer.older).toBe(1)
  })

  test('reads only the range a since names', async () => {
    write(entries())

    const answer = await read(local(), 'laravel.log', {level: 'error', since: '2026-08-27 11:00:00'})

    expect(answer.entries.map(one => one.message)).toEqual(['No certificate found again'])
  })

  test('leaves out a line that belongs to no entry when a level is asked for', async () => {
    write(['a log file that is not laravel\'s', line('2026-08-27 11:00:00', 'local', 'INFO', 'and then one that is')])

    const answer = await read(local(), 'laravel.log', {level: 'info'})

    expect(answer.entries.map(one => one.message)).toEqual(['and then one that is'])
  })

  test('refuses a level monolog does not have', async () => {
    write(entries())

    expect(() => read(local(), 'laravel.log', {level: 'eror'})).toThrow(/is not a level a log holds/)
  })

  test('answers with nothing when the file holds nothing', async () => {
    write([])

    const answer = await read(local(), 'laravel.log', {term: 'anything'})

    expect(answer.entries).toEqual([])
    expect(answer.older).toBe(0)
    expect(answer.read).toBe(0)
  })
})
