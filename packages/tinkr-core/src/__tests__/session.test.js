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

  test('answers once the shell has handed the terminal over and the command is still quiet', async () => {
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    // a command that does not use readline takes the terminal without saying so,
    // and it is reading by the time the handover has been quiet for a moment
    terminal.print(`${taken}user@host:~/app$ `)
    terminal.print(`\r\n${givenUp}\r`)
    jest.advanceTimersByTime(1500)
    await flush()

    expect(readied).toBe(true)
  })

  test('answers on a session that never hands the terminal over', async () => {
    // ssh and docker put the terminal into a mode of their own, and a shell
    // without readline never prints either escape
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    terminal.print('user@host:~/app$ ')
    // it is still read into on a moment of quiet, only a longer one than a shell
    // takes to read the files it starts with, which used to be written into
    jest.advanceTimersByTime(140)
    await flush()

    expect(readied).toBe(false)

    jest.advanceTimersByTime(1500)
    await flush()

    expect(readied).toBe(true)
  })

  test('answers on a session that says nothing at all', async () => {
    let readied = false

    session.ready().then(() => {
      readied = true
    })

    jest.advanceTimersByTime(5000)
    await flush()

    expect(readied).toBe(true)
  })
})
