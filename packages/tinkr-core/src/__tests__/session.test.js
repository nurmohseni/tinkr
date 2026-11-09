// a session spawned for a run is the fake terminal below rather than a shell:
// what a run sends and what it reads are the protocol under test, not a login
jest.mock('node-pty', () => ({spawn: jest.fn()}))
jest.mock('default-shell', () => '/bin/sh')
jest.mock('os-locale', () => ({sync: () => 'en-US'}))

const {spawn} = require('node-pty')

const {Session, SessionError, runCode, withoutPager} = require('../session')

/**
 * A pty that is only listened to and written to: a session can be asked what it
 * waits for without a shell behind it.
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

describe('what a session is started with', () => {
  beforeEach(() => {
    spawn.mockReset()
  })

  test('starts the session with the psysh pager out of the way', () => {
    // psysh reads cli.pager before it looks for less, and a pager holds the pty,
    // so the value a run is wrapped in would never come back
    expect(withoutPager('php artisan tinker')).toBe('php -d cli.pager=cat artisan tinker')
    expect(withoutPager('  php artisan tinker')).toBe('  php -d cli.pager=cat artisan tinker')
    expect(withoutPager('php -d memory_limit=1G artisan tinker'))
      .toBe('php -d cli.pager=cat -d memory_limit=1G artisan tinker')
  })

  // the bug this waits against: the guard only matched a command that started
  // with `php `, so a versioned binary, a wrapper and a container — every one of
  // them a php that pages — sat behind `less` until the run timed out
  test('puts the pager out of the way wherever the php word is', () => {
    expect(withoutPager('php83 artisan tinker')).toBe('php83 -d cli.pager=cat artisan tinker')
    expect(withoutPager('php8.3 artisan tinker')).toBe('php8.3 -d cli.pager=cat artisan tinker')
    expect(withoutPager('/usr/bin/php8.3 artisan tinker'))
      .toBe('/usr/bin/php8.3 -d cli.pager=cat artisan tinker')
    expect(withoutPager('cd app && php artisan tinker'))
      .toBe('cd app && php -d cli.pager=cat artisan tinker')
    expect(withoutPager('lerd php artisan tinker'))
      .toBe('lerd php -d cli.pager=cat artisan tinker')
    expect(withoutPager('docker exec -it app php artisan tinker'))
      .toBe('docker exec -it app php -d cli.pager=cat artisan tinker')
    expect(withoutPager("docker exec -it 'my app' php83 artisan tinker"))
      .toBe("docker exec -it 'my app' php83 -d cli.pager=cat artisan tinker")
  })

  test('leaves a word that only begins with php, and the code after it, alone', () => {
    expect(withoutPager('phpunit --version')).toBe('phpunit --version')
    expect(withoutPager('/srv/php-app/bin/tinker')).toBe('/srv/php-app/bin/tinker')
    expect(withoutPager('./vendor/bin/tinker')).toBe('./vendor/bin/tinker')
    expect(withoutPager('')).toBe('')

    // the first php word is the binary; a php that appears inside the code it is
    // given is the code, not a second binary
    expect(withoutPager('php -r \'echo "php 8";\''))
      .toBe('php -d cli.pager=cat -r \'echo "php 8";\'')
  })

  // the command a container connection runs is built by containerCommand, not by
  // the form, and it is written into the session whole: the pager has to be put
  // out of the way there too
  test('writes the container command with the pager out of the way', () => {
    const terminal = fakeTerminal()

    spawn.mockReturnValue(terminal)

    const session = new Session({
      path: '',
      container_engine: 'docker',
      container_name: 'app',
      container_command: 'php83 artisan tinker',
    }, {log: {error: () => {}}})

    session.start()

    expect(terminal.written[0]).toContain('docker exec -it app php83 -d cli.pager=cat artisan tinker')
  })
})

describe('what a session waits for before it is handed a run', () => {
  // readline's two escapes: the shell handing the terminal back before it runs
  // the command, and the command taking it along with the prompt it prints next
  const givenUp = '\u001b[?2004l'
  const taken = '\u001b[?2004h'

  let session = null
  let terminal = null

  beforeEach(() => {
    jest.useFakeTimers()
    terminal = fakeTerminal()
    session = new Session({path: '/tmp'}, {log: {error: () => {}}})
    session.pty = terminal
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // the bug this waits against: written into while the shell still owns the
  // terminal, a run past the terminal's 4096 byte buffer is dropped in half and
  // the session parses a statement that never finishes
  test('waits while the shell is still reading its own command line', async () => {
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    // the shell is reading, and it is quiet while it reads the files it starts
    // with: silence is not the command being ready, so nothing settles this but
    // the shell handing the terminal over
    terminal.print(`${taken}user@host:~/app$ `)
    jest.advanceTimersByTime(2000)
    await flush()

    expect(readied).toBe(false)
  })

  test('answers once the command has taken the terminal', async () => {
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    terminal.print(`${taken}user@host:~/app$ `)
    // bash hands the terminal back before it runs the command...
    terminal.print(`\r\n${givenUp}\r`)
    jest.advanceTimersByTime(1000)
    await flush()

    expect(readied).toBe(false)

    // ...and tinker takes it, along with the prompt the run is read behind
    terminal.print(`Psy Shell v0.12.18 (PHP 8.2.34 — cli) by Justin Hileman\r\n${taken}> `)
    await flush()

    expect(readied).toBe(true)
  })

  // the bug this waits against: libedit takes the terminal without the bracket
  // paste escape, so a session over ssh to a Debian or Ubuntu php sat out the
  // whole fifteen second limit before every run was even typed
  test('answers once psysh prints its prompt through libedit', async () => {
    session = new Session({path: '/tmp', is_over_ssh: true}, {log: {error: () => {}}})
    session.pty = terminal

    let readied = false

    session.ready().then(() => {
      readied = true
    })

    terminal.print(`${taken}user@host:~$ `)
    terminal.print(`ssh -t host 'php artisan tinker'\r\n${givenUp}\r`)
    terminal.print('\u001b[90mPsy Shell v0.12.18 (PHP 8.2.35 — cli) by Justin Hileman\u001b[39m\r\n')
    await flush()

    // the banner is psysh booting, not psysh reading
    expect(readied).toBe(false)

    terminal.print('> ')
    await flush()

    expect(readied).toBe(true)
  })

  test('does not take a prompt the shell printed before the handover for psysh', async () => {
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    // a line the shell reads as unfinished is answered with its own `> `
    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print("echo 'php artisan tinker\r\n> ")
    jest.advanceTimersByTime(1000)
    await flush()

    expect(readied).toBe(false)
  })

  // a quiet command is not a reading one: a run written into a command that has
  // not taken the terminal is flushed when it finally does, so the session says
  // the command never got anywhere rather than spending the run timeout
  test('does not take a quiet command for a reading one', async () => {
    let readied = false
    let failed = null

    session.ready().then(() => {
      readied = true
    }, error => {
      failed = error
    })

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    jest.advanceTimersByTime(4999)
    await flush()

    expect(readied).toBe(false)

    jest.advanceTimersByTime(1)
    await flush()

    expect(readied).toBe(false)
    expect(failed.name).toBe('SessionError')
    expect(failed.message).toContain('printed nothing back')
    expect(failed.message).toContain('never started reading the terminal')
  })

  test('answers at the limit for a command that printed but never said it was reading', async () => {
    // sqlite3, mysql, redis-cli: they take the terminal without the escape
    // readline prints, so their own prompt is the sign they are up
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    terminal.print('Connected to a row store.\r\nsqlite> ')
    jest.advanceTimersByTime(5000)
    await flush()

    expect(readied).toBe(true)
  })

  test('answers on a session that never hands the terminal over', async () => {
    // a shell without readline never prints either escape, and nothing in its
    // output says whether the command it runs is up: the limit is what keeps the
    // session from waiting for a handover that is not coming
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    terminal.print('user@host:~/app$ ')
    jest.advanceTimersByTime(4999)
    await flush()

    expect(readied).toBe(false)

    jest.advanceTimersByTime(1)
    await flush()

    expect(readied).toBe(true)
  })

  test('answers on a session that says nothing at all', async () => {
    // nothing proves a command was handed the terminal — a shell without
    // readline is quiet too — so this is the limit, not a verdict. A line that
    // never connected is ssh's own bound to report (see controlOptions)
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    jest.advanceTimersByTime(5000)
    await flush()

    expect(readied).toBe(true)
  })

  test('gives a session over ssh longer to boot, and says so when it printed nothing', async () => {
    // a dial, a login and a machine that is not this one are paid before the
    // command starts, and a run written before the command reads is a run lost
    session = new Session({path: '/tmp', is_over_ssh: true}, {log: {error: () => {}}})
    session.pty = terminal

    let readied = false
    let failed = null

    session.ready().then(() => {
      readied = true
    }, error => {
      failed = error
    })

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    jest.advanceTimersByTime(14999)
    await flush()

    expect(readied).toBe(false)

    jest.advanceTimersByTime(1)
    await flush()

    expect(failed.name).toBe('SessionError')
    expect(failed.message).toContain('the ssh line was still connecting')
  })

  // the bug this waits against: a key connection lets ssh ask its own question,
  // and the answer used to be fifteen seconds of silence followed by "the ssh
  // line was still connecting" — which says nothing about what ssh was waiting
  // for. The key is never accepted on the person's behalf: the message says
  // where to accept it
  test('says ssh is waiting for a host key to be accepted', async () => {
    session = new Session({path: '/tmp', is_over_ssh: true}, {log: {error: () => {}}})
    session.pty = terminal

    const failure = session.ready().then(() => null, error => error)

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    terminal.print("The authenticity of host 'example.com (10.0.0.2)' can't be established.\r\n")
    terminal.print('ED25519 key fingerprint is SHA256:abcdef.\r\n')
    terminal.print('Are you sure you want to continue connecting (yes/no/[fingerprint])? ')

    const error = await failure

    expect(error).toBeInstanceOf(SessionError)
    expect(error.message).toContain('host key question')
    expect(error.message).toContain('known_hosts')
    expect(error.message).toContain('Connect once from a terminal')

    // nothing was spent on the ready limit
    jest.advanceTimersByTime(0)
  })

  test('says ssh refused a key that is not the one it saw before', async () => {
    session = new Session({path: '/tmp', is_over_ssh: true}, {log: {error: () => {}}})
    session.pty = terminal

    const failure = session.ready().then(() => null, error => error)

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    terminal.print('@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n')
    terminal.print('@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n')
    terminal.print('Host key verification failed.\r\n')

    const error = await failure

    expect(error).toBeInstanceOf(SessionError)
    expect(error.message).toContain('changed host key')
    expect(error.message).toContain('known_hosts')
  })

  // a command that prints ordinary words is not a host key question: only the
  // line that asks it, or the banner that refuses it, is
  test('does not take ordinary boot output for a host key problem', async () => {
    session = new Session({path: '/tmp', is_over_ssh: true}, {log: {error: () => {}}})
    session.pty = terminal

    let readied = false

    session.ready().then(() => {
      readied = true
    })

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    terminal.print('Psy Shell v0.12.18 (PHP 8.2.35 — cli) by Justin Hileman\r\n')
    terminal.print(`${taken}> `)
    await flush()

    expect(readied).toBe(true)
  })

  // the bug this waits against: a command that never booted leaves the shell at
  // its own prompt, which takes the terminal with the same escape a command's
  // prompt does, so the run was written into the shell and the caller waited out
  // the whole timeout for an answer that could not come
  test('fails as soon as the command exits instead of answering with a prompt', async () => {
    let failed = null

    session.ready().catch(error => {
      failed = error
    })

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    // the command printed what went wrong and the shell came back
    terminal.print('Could not open input file: artisan\r\n')
    terminal.print('\r\n\u001b]9999;1\u0007')
    await flush()

    expect(failed).toBeInstanceOf(Error)
    expect(failed.name).toBe('SessionError')
    expect(failed.message).toContain('Could not open input file: artisan')
    expect(failed.message).toContain('exit status 1')
    expect(failed.status).toBe(1)
    // before any timeout was spent
    jest.advanceTimersByTime(0)
  })

  test('fails with the status alone when the command printed nothing', async () => {
    let failed = null

    session.ready().catch(error => {
      failed = error
    })

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    terminal.print('\u001b]9999;127\u0007')
    await flush()

    expect(failed.message).toContain('exit status 127')
    expect(failed.output).toBe('')
  })
})

describe('how a run is typed into a session', () => {
  let session = null
  let terminal = null

  beforeEach(() => {
    jest.useFakeTimers()
    terminal = fakeTerminal()
    session = new Session({path: '/tmp'}, {log: {error: () => {}}})
    session.pty = terminal
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // the bug this waits against: a line typed while psysh is between two reads
  // is echoed by the terminal itself, torn into the echo of the line before it,
  // and the pieces read as what the run printed
  test('types each line once psysh has read the one before it', async () => {
    let typed = false

    session.type(['echo eval(base64_decode(/*tinkr*/\'YWJj\'', '.\'ZGVm\'', '));']).then(() => {
      typed = true
    })

    expect(terminal.written).toEqual(['echo eval(base64_decode(/*tinkr*/\'YWJj\'\r'])

    // the echo of the line is not psysh reading the next one
    terminal.print('echo eval(base64_decode(/*tinkr*/\'YWJj\'')
    expect(terminal.written).toHaveLength(1)

    terminal.print('\r\n. ')
    expect(terminal.written).toEqual(['echo eval(base64_decode(/*tinkr*/\'YWJj\'\r', '.\'ZGVm\'\r'])

    terminal.print(".'ZGVm'\r\n\u001b[?2004h. ")
    await flush()

    expect(terminal.written[2]).toBe('));\r')
    expect(typed).toBe(true)
  })

  test('hands the rest over at once when psysh never shows its prompt', async () => {
    let typed = false

    session.type(['one', 'two', 'three']).then(() => {
      typed = true
    })

    terminal.print('one\r\nmy-prompt: ')
    jest.advanceTimersByTime(4999)
    expect(terminal.written).toEqual(['one\r'])

    jest.advanceTimersByTime(1)
    await flush()

    expect(terminal.written).toEqual(['one\r', 'two\rthree\r'])
    expect(typed).toBe(true)
  })
})

describe('what a session says when the command exits after it is ready', () => {
  const givenUp = '\u001b[?2004l'
  const taken = '\u001b[?2004h'

  let session = null
  let terminal = null

  beforeEach(() => {
    terminal = fakeTerminal()
    session = new Session({path: '/tmp'}, {log: {error: () => {}}})
    session.pty = terminal
  })

  // the session is up, so there is no ready() left to tell anyone: the shell
  // prints the status of the command it was given when that command ends, and
  // that is the only thing coming
  const readySession = async () => {
    const readied = session.ready()

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    terminal.print(`${taken}> `)

    await readied
    await flush()
  }

  test('reports the status of a command that exits after boot', async () => {
    await readySession()

    const exits = []

    session.onCommandExit(error => exits.push(error))

    // the marker, the status and its terminator are not promised to arrive in
    // one chunk: a pty hands over what it has when it has it
    terminal.print('the output of the command\u001b]999')
    terminal.print('9;137\u0007')
    await flush()

    expect(exits).toHaveLength(1)
    expect(exits[0]).toBeInstanceOf(SessionError)
    expect(exits[0].status).toBe(137)
    expect(exits[0].message).toContain('exit status 137')
  })

  test('does not take a frame the shell did not end with the bell', async () => {
    await readySession()

    const exits = []

    session.onCommandExit(error => exits.push(error))

    // the marker, the digits, but not the bell: not the frame bootSentinel
    // prints, so it says nothing about the command
    terminal.print('output that ends with a marker\u001b]9999;0X')
    await flush()

    expect(exits).toHaveLength(0)

    // the real frame that follows is still read
    terminal.print('\u001b]9999;0\u0007')
    await flush()

    expect(exits).toHaveLength(1)
    expect(exits[0].status).toBe(0)
  })

  test('waits for the digits of the status to end', async () => {
    await readySession()

    const exits = []

    session.onCommandExit(error => exits.push(error))

    terminal.print('\u001b]9999;13')
    await flush()

    expect(exits).toHaveLength(0)

    terminal.print('7\u0007')
    await flush()

    expect(exits).toHaveLength(1)
    expect(exits[0].status).toBe(137)
  })

  test('reads a frame whose status the shell did not name', async () => {
    await readySession()

    const exits = []

    session.onCommandExit(error => exits.push(error))

    // the documented frame is digits and the bell; an empty status is the frame
    // with nothing between them, and it is still the command ending
    terminal.print('\u001b]9999;\u0007')
    await flush()

    expect(exits).toHaveLength(1)
    expect(exits[0].status).toBe(null)
    expect(exits[0].message).toContain('while the run was going')
  })

  test('answers a subscription made after the command exited', async () => {
    await readySession()

    terminal.print('\u001b]999')
    terminal.print('9;0\u0007')
    await flush()

    const exits = []

    session.onCommandExit(error => exits.push(error))
    await flush()

    expect(exits).toHaveLength(1)
    expect(exits[0].status).toBe(0)
  })

  // the bug this waits against: the status can arrive in the same chunk as the
  // value the run printed, and answering the exit first would throw the value
  // away. The exit is delivered after every listener for that chunk has read it
  test('delivers the exit after the rest of the chunk', async () => {
    await readySession()

    const order = []

    session.onCommandExit(() => order.push('exit'))
    session.onData(() => order.push('value'))

    terminal.print('a value and a status\u001b]9999;0\u0007')
    await flush()

    expect(order).toEqual(['value', 'exit'])
  })
})

describe('a run whose command exits', () => {
  const givenUp = '\u001b[?2004l'
  const taken = '\u001b[?2004h'
  const settle = () => new Promise(resolve => setImmediate(resolve))

  beforeEach(() => {
    spawn.mockReset()
  })

  // the session reads its command's terminal as a shell does; what the run then
  // writes and what comes back to it are what this is about
  const boot = async (terminal, timeout = 0) => {
    spawn.mockReturnValue(terminal)

    const run = runCode({path: ''}, 'return 1;', {
      command: 'php artisan tinker',
      timeout,
    })

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    terminal.print(`${taken}> `)

    await settle()

    // psysh answers each line it reads with its prompt, and the run is typed a
    // line at a time: the fake session answers until the last line is written,
    // which leaves no readline wait behind the test
    for (let line = 0; line < 200; line++) {
      if (terminal.written.some(data => data.includes('/*tinkr:end*/'))) {
        break
      }

      terminal.print('> ')
    }

    await settle()

    // the run is still going: returned in an object, because a promise returned
    // from an async function is awaited, and the caller injects the failure the
    // run is waiting for
    return {run}
  }

  /**
   * The marker the run prints before it evaluates, as the session was given it.
   *
   * The typed lines are base64 of the wrapper, so the wrapper is what decoding
   * them answers: this is the marker php prints first, and printing it is what
   * makes what follows the run's own output rather than the session booting.
   *
   * @param {Object} terminal
   * @return {String}
   */
  const startMarkerOf = terminal => {
    const encoded = terminal.written
      .filter(line => line.includes('/*tinkr*/'))
      .map(line => {
        const piece = /'([A-Za-z0-9+/=]*)'/.exec(line)

        return piece ? piece[1] : ''
      })
      .join('')
    const wrapper = Buffer.from(encoded, 'base64').toString('utf8')
    const [, first, second] = /\$tinkr_start='([^']+)'\.'([^']+)'/.exec(wrapper)

    return first + second
  }

  // the bug this waits against: a run with no timeout waited forever for a php
  // that had been killed, because the only sign it was gone was the status the
  // shell printed after it
  test('fails at once when php exits under a run given no timeout', async () => {
    const terminal = fakeTerminal()
    const {run} = await boot(terminal)
    const failure = run.then(() => null, error => error)

    terminal.print('the last thing php printed\u001b]999')
    terminal.print('9;137\u0007')

    const error = await failure

    expect(error).toBeInstanceOf(SessionError)
    expect(error.status).toBe(137)
    expect(error.message).toContain('exit status 137')
  })

  // the bug this waits against: php printed what it printed before it was
  // killed, and only the status said why the run stopped. The answer's output
  // is the run's, so the pane keeps what the terminal showed instead of it
  // being emptied by the error
  test('keeps what the run printed before php exited', async () => {
    const terminal = fakeTerminal()
    const {run} = await boot(terminal)
    const failure = run.then(() => null, error => error)
    const start = startMarkerOf(terminal)

    expect(start).toMatch(/^STRT[0-9A-F]+$/)

    // the run started and printed, and then its php was killed
    terminal.print(`${start}\r\nhello before the kill\r\n`)
    terminal.print('\u001b]999')
    terminal.print('9;137\u0007')

    const error = await failure

    expect(error).toBeInstanceOf(SessionError)
    expect(error.status).toBe(137)
    expect(error.output).toBe('hello before the kill')
  })

  // the bug this waits against: a run that outlived its time was answered with
  // a bare error, so what php had printed was lost, while every other failure
  // of the run carried it
  test('answers a run that outlived its time with what it printed, and marks it', async () => {
    const terminal = fakeTerminal()
    const {run} = await boot(terminal, 400)
    const failure = run.then(() => null, error => error)
    const start = startMarkerOf(terminal)

    expect(start).toMatch(/^STRT[0-9A-F]+$/)

    // the run started and printed, and then its time ran out
    terminal.print(`${start}\r\nstill working\r\n`)

    const error = await failure

    expect(error.timedOut).toBe(true)
    expect(error.message).toContain('did not answer within 400ms')
    expect(error.output).toBe('still working')
  })

  test('keeps the command\'s words when the sentinel is split while it boots', async () => {
    const terminal = fakeTerminal()

    spawn.mockReturnValue(terminal)

    const run = runCode({path: ''}, 'return 1;', {command: 'php artisan tinker', timeout: 0})

    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    terminal.print('Could not open input file: artisan\r\n')
    terminal.print('\u001b]999')
    terminal.print('9;1\u0007')

    const error = await run.then(() => null, failure => failure)

    expect(error).toBeInstanceOf(SessionError)
    expect(error.status).toBe(1)
    expect(error.message).toContain('Could not open input file: artisan')
  })

  test('fails at once when the shell itself goes away', async () => {
    const terminal = fakeTerminal()
    const {run} = await boot(terminal)
    const failure = run.then(() => null, error => error)

    terminal.exit()

    const error = await failure

    expect(error).toBeInstanceOf(SessionError)
    expect(error.message).toContain('session exited')
  })
})
