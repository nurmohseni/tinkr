jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => Buffer.from('000102030405', 'hex')),
}))
jest.mock('node-pty', () => ({}))
jest.mock('default-shell', () => '/bin/bash')
jest.mock('os-locale', () => ({sync: () => 'en-US'}))
jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp'}}))
jest.mock('electron-store', () => class Store {})

const {BackgroundPty} = require('../BackgroundPty')
const {randomBytes} = require('crypto')

// what BackgroundPty asks the session to print: the marker, its reverse, and
// the base64 of the json in between
const marker = 'PHPFORM000102030405'
const endMarker = '504030201000MROFPHP'

// the terminal writes a soft wrap as `ESC[m \b`: it prints a space and takes it
// back, so the line stays intact while it wraps
const wrap = '\u001b[m \b'

// the shape of a session: the line is echoed when it is written and again while
// tinker reads it, then the value is printed and the prompt follows
const session = (output, callMarker = marker) => [
  'php artisan tinker\r\n',
  `$m='${callMarker}';echo $m.base64_encode(json_encode((...))).strrev($m);\r\n`,
  'Psy Shell v0.12.8 (PHP 8.3.35 — cli) by Justin Hileman\r\n',
  `\u001b[?2004h> $m='${callMarker}';echo $m.base64_encode(json_encode((...))).strrev($m);\r\n`,
  '\u001b[?2004l\r\u001b[?1h\u001b=\r',
  output,
  '⏎\u001b[m\r\n\r\u001b[K\u001b[?1l\u001b>\u001b[?2004h> ',
].join('')

const base64 = value => Buffer.from(value, 'utf8').toString('base64')

const fakeSession = () => {
  const listeners = new Set()

  return {
    listeners,
    onData: listener => {
      listeners.add(listener)

      return {dispose: () => listeners.delete(listener)}
    },
    write: jest.fn(),
    kill: jest.fn(),
  }
}

const backgroundPty = () => {
  const pty = new BackgroundPty({id: 'test', path: '/tmp'})
  pty.session = fakeSession()

  return pty
}

const feed = (pty, data) => {
  for (const listener of [...pty.session.listeners]) {
    listener(data)
  }
}

const bytes = hex => Buffer.from(hex, 'hex')

afterEach(() => {
  jest.useRealTimers()
  randomBytes.mockImplementation(() => bytes('000102030405'))
})

describe('test BackgroundPty', () => {
  test('should read the json the session printed', async () => {
    const pty = backgroundPty()
    const result = pty.jsonResult("function () { return ['a' => 1]; }")

    feed(pty, session(`${marker}${base64('{"a":1}')}${endMarker}`))

    await expect(result).resolves.toBe('{"a":1}')
  })

  test('should read a value the terminal wrapped', async () => {
    const value = JSON.stringify({first: 'y'.repeat(80), second: 'z'.repeat(80)})
    const payload = base64(value)

    // one wrap lands in the value, another one in the marker that closes it
    const output = `${marker}${payload.slice(0, 40)}${wrap}${payload.slice(40)}${endMarker.slice(0, 10)}${wrap}${endMarker.slice(10)}`

    const pty = backgroundPty()
    const result = pty.jsonResult('function () { return $this; }')

    feed(pty, session(output))

    await expect(result).resolves.toBe(value)
  })

  test('should read a value that arrives in pieces', async () => {
    const pty = backgroundPty()
    const result = pty.jsonResult("function () { return ['a' => 1]; }")

    const output = session(`${marker}${base64('{"a":1}')}${endMarker}`)

    for (let i = 0; i < output.length; i += 7) {
      feed(pty, output.slice(i, i + 7))
    }

    await expect(result).resolves.toBe('{"a":1}')
  })

  test('should not read an answer that was left over from another call', async () => {
    const pty = backgroundPty()
    const result = pty.jsonResult("function () { return ['a' => 1]; }")

    const stale = `${'PHPFORMFFEEDDCCBBAA'}${base64('{"stale":true}')}${'AABBCCDDEEFFMROFPHP'}`

    feed(pty, session(`${stale}${marker}${base64('{"a":1}')}${endMarker}`))

    await expect(result).resolves.toBe('{"a":1}')
  })

  test('should give up on a value when the session is killed', async () => {
    const pty = backgroundPty()
    const result = pty.jsonResult("function () { return ['a' => 1]; }")

    pty.kill()

    await expect(result).rejects.toThrow('The session was restarted, ask the form again.')
    expect(pty.session.listeners.size).toBe(0)
  })

  test('should stop listening when the value times out, and let the next one read', async () => {
    jest.useFakeTimers()

    const pty = backgroundPty()
    const timedOut = pty.jsonResult("function () { return ['a' => 1]; }")

    expect(pty.session.listeners.size).toBe(1)

    jest.advanceTimersByTime(15000)

    await expect(timedOut).rejects.toThrow('Timeout, try to reconnect!')
    expect(pty.session.listeners.size).toBe(0)
    expect(pty.pending).toBeNull()

    // the timeout is over, not the session: the next question is read normally
    const result = pty.jsonResult("function () { return ['b' => 2]; }")

    feed(pty, session(`${marker}${base64('{"b":2}')}${endMarker}`))

    await expect(result).resolves.toBe('{"b":2}')
    expect(pty.session.listeners.size).toBe(0)
  })

  test('should stop listening when a value is aborted', async () => {
    const pty = backgroundPty()
    const result = pty.jsonResult("function () { return ['a' => 1]; }")

    pty.abort()

    await expect(result).rejects.toThrow('The session was restarted, ask the form again.')
    expect(pty.session.listeners.size).toBe(0)
    expect(pty.pending).toBeNull()
  })

  test('should stop listening when the session cannot take the line', async () => {
    const pty = backgroundPty()

    pty.session.write.mockImplementation(() => {
      throw new Error('the session is gone')
    })

    const result = pty.jsonResult("function () { return ['a' => 1]; }")

    await expect(result).rejects.toThrow('the session is gone')
    expect(pty.session.listeners.size).toBe(0)
    expect(pty.pending).toBeNull()
  })

  test('should replace a value that is still being waited for', async () => {
    randomBytes
      .mockImplementationOnce(() => bytes('010203040506'))
      .mockImplementationOnce(() => bytes('0a0b0c0d0e0f'))

    const pty = backgroundPty()
    const replaced = pty.jsonResult("function () { return ['a' => 1]; }")
    const result = pty.jsonResult("function () { return ['b' => 2]; }")

    await expect(replaced).rejects.toThrow('The session was restarted, ask the form again.')

    // one listener, the new request's: the replaced request cannot read the
    // session any more
    expect(pty.session.listeners.size).toBe(1)

    let settled = false
    result.then(() => { settled = true }, () => { settled = true })

    // the answer to the replaced request arrives late; it is not the answer to
    // the new one, whose marker it does not carry
    feed(pty, session(`${'PHPFORM010203040506'}${base64('{"a":1}')}${'605040302010MROFPHP'}`, 'PHPFORM010203040506'))
    await Promise.resolve()

    expect(settled).toBe(false)

    feed(pty, session(`${'PHPFORM0A0B0C0D0E0F'}${base64('{"b":2}')}${'F0E0D0C0B0A0MROFPHP'}`, 'PHPFORM0A0B0C0D0E0F'))

    await expect(result).resolves.toBe('{"b":2}')
    expect(pty.session.listeners.size).toBe(0)
  })
})
