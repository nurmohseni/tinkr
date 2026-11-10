// a session on windows, on a machine that is not windows: the shell, its
// arguments and the line written into it are what this file pins, because the
// shell itself cannot be run here (see the report at the top of the win32 path
// in session.start)
jest.mock('node-pty', () => ({spawn: jest.fn()}))
jest.mock('default-shell', () => 'C:\\Windows\\system32\\cmd.exe')
jest.mock('os-locale', () => ({sync: () => 'en-US'}))

const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawn} = require('node-pty')

const {
  Session,
  SessionError,
  runCode,
  statusFrame,
  statusSentinel,
  bootSentinel,
  windowsBootSentinel,
  withoutPager,
} = require('../session')
const {RunResultFilter, typedRun} = require('../runResult')
const {parseSSHCommand} = require('../parseSSHCommand')

/**
 * A pty that is only listened to and written to, as the posix session tests have
 * one: what a session sends and what it reads are the protocol under test, not a
 * login.
 */
const fakeTerminal = () => {
  const listeners = new Set()
  const exitListeners = new Set()

  return {
    written: [],
    onData(cb) {
      listeners.add(cb)

      return {dispose: () => listeners.delete(cb)}
    },
    onExit(cb) {
      exitListeners.add(cb)

      return {dispose: () => exitListeners.delete(cb)}
    },
    write(data) {
      this.written.push(data)
    },
    print(data) {
      listeners.forEach(cb => cb(data))
    },
    exit() {
      exitListeners.forEach(cb => cb())
    },
    kill() {},
  }
}

const flush = () => Promise.resolve()

const windowsSession = (connection = {path: ''}, options = {}) =>
  new Session(connection, Object.assign({platform: 'win32', log: {error: () => {}}}, options))

describe('the status sentinel of a session', () => {
  test('is the posix frame on a posix shell, unchanged', () => {
    expect(bootSentinel).toBe(String.raw`;printf '\033]9999;%s\007' $?`)
    expect(statusSentinel('linux')).toBe(bootSentinel)
    expect(statusFrame('linux')).toEqual({marker: '\u001b]9999;', end: '\u0007'})
  })

  test('is an echo of the status in cmd, because cmd has no printf and no $?', () => {
    // `;` is not a separator in cmd — it is a word of its own, and artisan read
    // it as part of the command it was given — and neither `printf` nor `$?`
    // exists there. `&` separates, and `!ERRORLEVEL!` is the status of the
    // command on the left of it, read when that command finishes rather than
    // when the line is parsed (which is what `%ERRORLEVEL%` would do)
    expect(windowsBootSentinel).toBe(' & echo ::tinkr-exit:!ERRORLEVEL!::')
    expect(statusSentinel('win32')).toBe(windowsBootSentinel)
    expect(statusFrame('win32')).toEqual({marker: '::tinkr-exit:', end: '::'})
  })
})

describe('what a windows session is started with', () => {
  beforeEach(() => {
    spawn.mockReset()
  })

  test('starts cmd with delayed expansion, and writes the command with the cmd sentinel', () => {
    const terminal = fakeTerminal()

    spawn.mockReturnValue(terminal)

    const session = windowsSession()

    session.start('php artisan tinker')

    // `/V:ON` is what makes `!ERRORLEVEL!` in the sentinel mean anything: without
    // it cmd expands `%ERRORLEVEL%` when the line is read, before the command has
    // run (see the comment on statusFrames)
    expect(spawn).toHaveBeenCalledWith(
      'C:\\Windows\\system32\\cmd.exe',
      ['/V:ON'],
      expect.objectContaining({useConpty: true, encoding: 'utf-8'}),
    )

    // one line: the command with its pager out of the way, then the status of it
    expect(terminal.written).toEqual([
      `php -d cli.pager=cat artisan tinker${windowsBootSentinel}\r`,
    ])
  })

  test('gives a container connection the command built for cmd', () => {
    const terminal = fakeTerminal()

    spawn.mockReturnValue(terminal)

    const session = windowsSession({
      path: '',
      container_engine: 'docker',
      container_name: 'my app',
      container_command: 'php83 artisan tinker',
    })

    session.start()

    // the name is a word of *this* shell, so it is quoted by cmd's rule — a single
    // quote here would be an ordinary character and the name would be two words
    expect(terminal.written[0]).toContain(
      'docker exec -it ^"my^ app^" php83 -d cli.pager=cat artisan tinker',
    )
  })

  test('writes an ssh line whose words are cmd words and whose far side is still posix', () => {
    const terminal = fakeTerminal()

    spawn.mockReturnValue(terminal)

    const session = windowsSession({
      path: '/srv/my app',
      is_over_ssh: true,
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
    })

    session.start('php artisan tinker')

    const line = terminal.written[0]

    // `ssh` and `-t` are the program and its flag, and every option after them is
    // one word of cmd: single quotes would not quote anything there
    expect(line.startsWith('ssh -t ^"-o^" ^"ControlMaster=auto^"')).toBe(true)
    // the remote `cd` and the remote command are quoted for the far posix shell,
    // and the pair is then one word of this one — a cmd word, written for the
    // shell the session is typed into (see shell.cmdQuote)
    expect(line).toContain('^"cd^ \'/srv/my^ app\'^ ^&^&^ php^ -d^ cli.pager=cat^ artisan^ tinker^"')
    expect(line.endsWith(`${windowsBootSentinel}\r`)).toBe(true)
    // there is no `NAME=value command` form in cmd, and no login profile to
    // defeat: the helper's variables are in the pty's environment instead
    expect(line).not.toContain('SSH_ASKPASS=')
  })

  test('puts the helper\'s environment into the pty, which is the only half windows has', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-win-askpass-'))
    const terminal = fakeTerminal()

    spawn.mockReturnValue(terminal)

    try {
      const session = windowsSession({
        path: '',
        is_over_ssh: true,
        ssh_password: true,
        id: 'c1',
        ssh_server: 'db.example.com',
        ssh_user: 'root',
      }, {dataDir: dir})

      session.start('php artisan tinker')

      const options = spawn.mock.calls[0][2]

      // the pty's environment is what ssh inherits: the helper, the file the
      // secret is in, and the account a prompt has to name — and never the
      // password
      expect(options.env.SSH_ASKPASS).toBeTruthy()
      expect(options.env.SSH_ASKPASS_REQUIRE).toBe('force')
      expect(options.env.TINKR_SSH_SECRET_ID).toBe('c1')
      expect(options.env.TINKR_SSH_SECRET_WHO).toBe('root@db.example.com')
      expect(JSON.stringify(options.env)).not.toContain('password')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })
})

describe('what a windows session waits for before it is handed a run', () => {
  let session = null
  let terminal = null

  beforeEach(() => {
    jest.useFakeTimers()
    terminal = fakeTerminal()
    session = windowsSession()
    session.pty = terminal
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // cmd prints neither bracket-paste escape, so the posix handover never happens
  // there; psysh's own prompt is what says the command is reading, and the banner
  // is what says the prompt is psysh's rather than the shell's
  test('answers once psysh has booted and printed its prompt', async () => {
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    terminal.print('C:\\app>php artisan tinker & echo ::tinkr-exit:!ERRORLEVEL!::\r\n')
    terminal.print('Psy Shell v0.12.18 (PHP 8.2.34 — cli) by Justin Hileman\r\n')
    await flush()

    // the banner alone is psysh booting, not psysh reading
    expect(readied).toBe(false)

    terminal.print('> ')
    await flush()

    expect(readied).toBe(true)
  })

  // a console prints no space that moves nothing: psysh's `> ` reaches the run
  // as the prompt and a cursor move, and the prompt is what is left of it
  test('reads a prompt whose trailing space the console rendered as a cursor move', async () => {
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    terminal.print('C:\\app>php artisan tinker & echo ::tinkr-exit:!ERRORLEVEL!::\r\n')
    terminal.print('Psy Shell v0.12.18 (PHP 8.2.34 — cli) by Justin Hileman\r\n')
    await flush()

    expect(readied).toBe(false)

    terminal.print('>\u001b[K\u001b[1C')
    await flush()

    expect(readied).toBe(true)
  })

  test('does not take the shell\'s own prompt for psysh\'s', async () => {
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    // a person's PROMPT can end in `> `, which is the shape of psysh's prompt
    terminal.print('C:\\app> \r\n')
    jest.advanceTimersByTime(4999)
    await flush()

    expect(readied).toBe(false)

    // and the limit is still the answer when nothing else is
    jest.advanceTimersByTime(1)
    await flush()

    expect(readied).toBe(true)
  })

  test('recognises the status frame cmd echoes, which is the echo of the line', async () => {
    let failed = null

    session.ready().catch(error => {
      failed = error
    })

    // the line the shell echoes back holds the marker and `!ERRORLEVEL!` where the
    // digits of a status go: that is the echo, not the frame, and it is not read
    // as a status
    terminal.print('C:\\app>php artisan tinker & echo ::tinkr-exit:!ERRORLEVEL!::\r\n')
    await flush()

    expect(failed).toBe(null)
    expect(session.commandExit).toBe(null)

    terminal.print('\'php\' is not recognized as an internal or external command,\r\n')
    // the frame, split across two chunks like a pty hands it over
    terminal.print('::tinkr-exit:900')
    terminal.print('9::\r\n')
    await flush()

    expect(failed).toBeInstanceOf(SessionError)
    expect(failed.status).toBe(9009)
    expect(failed.message).toContain('is not recognized')
    expect(failed.message).toContain('exit status 9009')
  })

  test('reads a frame with no status in it, and one whose terminator is wrong', async () => {
    const exits = []

    session.ready().then(() => {}, () => {})

    // a marker, no digits, and the terminator: the command ended without a status
    terminal.print('::tinkr-exit:::')
    await flush()

    expect(session.commandExit).toBeInstanceOf(SessionError)
    expect(session.commandExit.status).toBe(null)

    const other = windowsSession()

    other.pty = terminal = fakeTerminal()
    other.ready().then(() => {}, () => {})

    // digits that no frame ends: not the shell's sentinel, so nothing is said
    terminal.print('a marker in output ::tinkr-exit:12XYZ')
    await flush()

    expect(other.commandExit).toBe(null)
    expect(exits).toHaveLength(0)
  })

  test('answers a subscription made after the command exited', async () => {
    session.ready().then(() => {}, () => {})

    terminal.print('::tinkr-exit:0::\r\n')
    await flush()

    const exits = []

    session.onCommandExit(error => exits.push(error))
    await flush()

    expect(exits).toHaveLength(1)
    expect(exits[0].status).toBe(0)
  })
})

describe('the lines a windows session types into psysh', () => {
  let session = null
  let terminal = null

  beforeEach(() => {
    jest.useFakeTimers()
    terminal = fakeTerminal()
    session = windowsSession()
    session.pty = terminal
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // the console keeps what it was given until psysh asks for it — there is no
  // readline to hand the terminal back and forth with here — so the whole run
  // goes in one write. Waiting for the prompt between lines on this platform
  // kept nothing in order that was out of order: it only made the run wait for
  // the echo of every line, a render at a time
  test('writes the whole run in one go, because the console holds it for psysh', async () => {
    let typed = false

    session.type(['one', 'two', 'three']).then(() => {
      typed = true
    })

    await flush()

    expect(terminal.written).toEqual(['one\rtwo\rthree\r'])
    expect(typed).toBe(true)
  })

  test('writes nothing into a session that has no terminal', async () => {
    session.pty = null

    await session.type(['one'])
  })
})

describe('the run a local windows console is handed', () => {
  const run = {code: '<?php echo "hello";', marker: 'TINKR1', start: 'STRT1'}

  // the console echoes every character typed into it, a render at a time, so a
  // run of forty lines costs seventeen seconds of echo before the run's own
  // answer can arrive behind them. The run goes into a file, and the console is
  // given the one line that reads it back, which is echoed in a blink
  test('goes into a file, and the console is given the line that reads it', () => {
    const typed = windowsSession({path: '', command: 'php artisan tinker'}).runLines(run)

    expect(typed.lines).toHaveLength(1)

    const line = typed.lines[0]
    const file = /file_get_contents\('((?:[^'\\]|\\.)*)'\)/.exec(line)[1].replace(/\\(.)/g, '$1')

    expect(line).toMatch(/^echo eval\(base64_decode\(\/\*tinkr\*\/file_get_contents\('(?:[^'\\]|\\.)*'\)\)\);\/\*tinkr:end\*\/$/)
    expect(file).toMatch(/tinkr-run-[0-9a-f]{12}\.txt$/)
    // the same base64 a typed run carries, in one piece: nothing reads it but
    // php, so the lines a console is typed are not needed
    expect(fs.readFileSync(file, 'utf8')).toBe(Buffer.from(run.code, 'utf8').toString('base64'))

    typed.remove()

    expect(fs.existsSync(file)).toBe(false)
  })

  // the line carries the markers the typed run carries, so the console echoing
  // it back is the session talking about the run rather than the run printing:
  // the terminal drops it, and so does the run's own stream
  test('is echoed into a line that closes the echo it opened', () => {
    const typed = windowsSession({path: ''}).runLines(run)
    const filter = new RunResultFilter(run.marker, run.start)

    expect(typed.lines[0]).toContain('/*tinkr*/')
    expect(typed.lines[0]).toContain('/*tinkr:end*/')
    expect(filter.push(`${typed.lines[0]}\r\n`)).toEqual({output: '', run: '', result: null})

    typed.remove()
  })

  test('stays in the terminal when php is not on this machine', () => {
    // a file this app writes is not in a container, nor on a server: those keep
    // the run in the terminal, where it is read by their own psysh
    const container = windowsSession({path: '', container_engine: 'docker', container: 'app'})
    const ssh = windowsSession({path: '/srv/app', is_over_ssh: true})

    ;[container, ssh].forEach(session => {
      const typed = session.runLines(run)

      expect(typed.lines.length).toBeGreaterThan(1)
      expect(typed.lines).toEqual(typedRun(run.code))
      expect(() => typed.remove()).not.toThrow()
    })
  })

  test('stays in the terminal on posix, where the console does not echo what it is given', () => {
    const session = new Session({path: ''}, {platform: 'linux', log: {error: () => {}}})
    const typed = session.runLines(run)

    expect(typed.lines).toEqual(typedRun(run.code))
  })
})

describe('a run of a local windows connection', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    spawn.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // the console echoes every character typed into it a render at a time, so a run
  // of forty lines is seventeen seconds of echo before the run's own answer can
  // arrive behind it. It goes into a file instead, and the console is given the
  // one line that reads it: what psysh evaluates is the same wrapper either way,
  // and the file is nothing once the run has answered
  test('is typed as one line, and its file is gone once it has answered', async () => {
    const terminal = fakeTerminal()

    spawn.mockReturnValue(terminal)

    const run = runCode({path: ''}, 'return 1;', {
      command: 'php artisan tinker',
      timeout: 0,
      platform: 'win32',
    })

    terminal.print('C:\\app>php artisan tinker & echo ::tinkr-exit:!ERRORLEVEL!::\r\n')
    terminal.print('Psy Shell v0.12.18 (PHP 8.2.34 — cli) by Justin Hileman\r\n')
    terminal.print('> ')
    await flush()

    const typed = terminal.written.filter(data => data.includes('file_get_contents'))

    expect(typed).toHaveLength(1)

    const file = /file_get_contents\('(.*)'\)/.exec(typed[0])[1].replace(/\\(.)/g, '$1')
    // the wrapper is in the file, whole: the marker and the start marker are the
    // wrapper's own, and what answers the run is printed inside them
    const wrapper = Buffer.from(fs.readFileSync(file, 'utf8'), 'base64').toString('utf8')
    const marker = `TINKR${/\$tinkr='TINK'\.'R([0-9A-F]{12})'/.exec(wrapper)[1]}`
    const start = `STRT${/\$tinkr_start='STRT'\.'([0-9A-F]{12})'/.exec(wrapper)[1]}`

    // the console echoing the line back, which the terminal drops, and then the
    // run's own stream: the start marker, and the value inside the envelope
    terminal.print(`${typed[0]}\r\n`)
    terminal.print(start)
    terminal.print(`${marker}@${Buffer.from(JSON.stringify({value: 1, error: null})).toString('base64')}@`)

    const result = await run

    expect(result.value).toBe(1)
    expect(fs.existsSync(file)).toBe(false)
  })
})

describe('the line a windows session starts php with', () => {
  test('keeps the pager out of the way of a cmd command as it did on posix', () => {
    expect(withoutPager('php artisan tinker')).toBe('php -d cli.pager=cat artisan tinker')
    expect(withoutPager('docker exec -it "my app" php83 artisan tinker'))
      .toBe('docker exec -it "my app" php83 -d cli.pager=cat artisan tinker')
  })

  test('is one cmd word for the remote side of an ssh line', () => {
    const line = parseSSHCommand({
      path: '/srv/my app',
      is_over_ssh: true,
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
    }, 'php artisan tinker', null, 'win32')

    // the far command, quoted posix for the far shell and cmd for this one
    expect(line).toContain('^"cd^ \'/srv/my^ app\'^ ^&^&^ php^ artisan^ tinker^"')

    // a session with no command runs the account's login shell there, and that
    // word is cmd-quoted too
    expect(parseSSHCommand({
      path: '/srv/app',
      is_over_ssh: true,
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
    }, null, null, 'win32')).toContain('^"cd^ \'/srv/app\'^ ^&^&^ exec^ bash^ --login^ -i^"')
  })

  test('says why a connection ssh cannot be given is not used, in cmd', () => {
    // the message holds double quotes, and a cmd word escapes them for the
    // program's parser: an unescaped one would end the word in the middle and
    // leave the rest of the message to cmd
    expect(parseSSHCommand({ssh_user: '-oProxyCommand=x', ssh_server: 'host'}, null, null, 'win32'))
      .toBe('echo ^"Tinkr:^ the^ ssh^ user^ and^ server^ cannot^ start^ with^ \\^"-\\^"^"')
  })
})
