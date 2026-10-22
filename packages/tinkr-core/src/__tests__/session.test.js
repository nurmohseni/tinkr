const {Session, withoutPager} = require('../session')

/**
 * A pty that is only listened to and written to: a session can be asked what it
 * waits for without a shell behind it.
 */
const fakeTerminal = () => {
  const listeners = new Set()

  return {
    written: [],
    onData(cb) {
      listeners.add(cb)

      return {dispose: () => listeners.delete(cb)}
    },
    write(data) {
      this.written.push(data)
    },
    print(data) {
      listeners.forEach(cb => cb(data))
    },
  }
}

const flush = () => Promise.resolve()

describe('what a session is started with', () => {
  test('starts the session with the psysh pager out of the way', () => {
    // psysh reads cli.pager before it looks for less, and a pager holds the pty,
    // so the value a run is wrapped in would never come back
    expect(withoutPager('php artisan tinker')).toBe('php -d cli.pager=cat artisan tinker')
    expect(withoutPager('  php artisan tinker')).toBe('  php -d cli.pager=cat artisan tinker')
    expect(withoutPager('php -d memory_limit=1G artisan tinker'))
      .toBe('php -d cli.pager=cat -d memory_limit=1G artisan tinker')
  })

  test('leaves a command it cannot put an ini setting into alone', () => {
    expect(withoutPager('php8.2 artisan tinker')).toBe('php8.2 artisan tinker')
    expect(withoutPager('./vendor/bin/tinker')).toBe('./vendor/bin/tinker')
    expect(withoutPager('cd app && php artisan tinker')).toBe('cd app && php artisan tinker')
    expect(withoutPager('')).toBe('')
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
