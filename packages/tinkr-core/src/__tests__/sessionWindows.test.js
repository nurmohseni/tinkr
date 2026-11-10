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
  statusFrame,
  statusSentinel,
  bootSentinel,
  windowsBootSentinel,
  withoutPager,
} = require('../session')
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
