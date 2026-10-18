jest.mock('crypto', () => ({
  randomBytes: () => Buffer.from('000102030405', 'hex'),
}))
jest.mock('node-pty', () => ({}))
jest.mock('default-shell', () => '/bin/bash')
jest.mock('os-locale', () => ({sync: () => 'en-US'}))
jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp'}}))
jest.mock('electron-store', () => class Store {})

const {BackgroundPty} = require('../BackgroundPty')

// what BackgroundPty asks the session to print: the marker, its reverse, and
// the base64 of the json in between
const marker = 'PHPFORM000102030405'
const endMarker = '504030201000MROFPHP'

// the terminal writes a soft wrap as `ESC[m \b`: it prints a space and takes it
// back, so the line stays intact while it wraps
const wrap = '\u001b[m \b'

// the shape of a session: the line is echoed when it is written and again while
// tinker reads it, then the value is printed and the prompt follows
const session = output => [
  'php artisan tinker\r\n',
  `$m='${marker}';echo $m.base64_encode(json_encode((...))).strrev($m);\r\n`,
  'Psy Shell v0.12.8 (PHP 8.3.35 — cli) by Justin Hileman\r\n',
  `\u001b[?2004h> $m='${marker}';echo $m.base64_encode(json_encode((...))).strrev($m);\r\n`,
  '\u001b[?2004l\r\u001b[?1h\u001b=\r',
  output,
  '⏎\u001b[m\r\n\r\u001b[K\u001b[?1l\u001b>\u001b[?2004h> ',
].join('')

const base64 = value => Buffer.from(value, 'utf8').toString('base64')

const fakeSession = () => {
  const listeners = []

  return {
    listeners,
    onData: listener => {
      listeners.push(listener)

      return {dispose: () => {}}
    },
    write: () => {},
    kill: () => {},
  }
}

const backgroundPty = () => {
  const pty = new BackgroundPty({id: 'test', path: '/tmp'})
  pty.session = fakeSession()

  return pty
}

const feed = (pty, data) => {
  for (const listener of pty.session.listeners) {
    listener(data)
  }
}

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
  })
})
