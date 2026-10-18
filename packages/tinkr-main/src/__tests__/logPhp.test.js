/**
 * The php the log service builds for a machine this one is not on.
 *
 * Every other test of it mocks `spawn`, so the php itself is never parsed, never
 * run, and a syntax error or a wrong regex in it is invisible until someone with
 * an ssh connection finds it. This one runs it.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const {execFileSync} = require('child_process')

// the service reaches for spawn to ask another machine; this test runs a real
// process, so only spawn is replaced and the synchronous call stays real
jest.mock('child_process', () => Object.assign({}, jest.requireActual('child_process'), {spawn: jest.fn()}))

const {windowPhp, parse} = require('../services/logs')

let root = ''
let file = ''
let text = ''

const line = (at, level, message) => `[${at}] production.${level}: ${message}`

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-php-'))

  text = [
    line('2026-08-27 10:00:00', 'ERROR', 'first'),
    '[stacktrace]',
    '#0 /app/a.php(1): go()',
    line('2026-08-27 11:00:00', 'INFO', 'second'),
    line('2026-08-27 11:30:00', 'INFO', 'third'),
    line('2026-08-27 12:00:00', 'INFO', 'fourth'),
  ].join('\n') + '\n'

  file = path.join(root, 'laravel.log')
  fs.writeFileSync(file, text)
})

afterAll(() => fs.rmSync(root, {recursive: true, force: true}))

// run the php it built, and answer with what it printed
const run = (since, until) => {
  const script = path.join(root, 'q.php')

  fs.writeFileSync(script, `<?php ${windowPhp(file, 1024, '$n', since, until)}`)

  return JSON.parse(execFileSync('php', [script], {encoding: 'utf8'}))
}

test('is php that parses', () => {
  const script = path.join(root, 'l.php')

  fs.writeFileSync(script, `<?php ${windowPhp(file, 1024, '$n', '2026-08-27 11:00:00', '')}`)

  expect(() => execFileSync('php', ['-l', script], {encoding: 'utf8', stdio: 'pipe'})).not.toThrow()
})

test('finds the range in the file, past a bracketed continuation line', () => {
  const answer = run('2026-08-27 11:00:00', '2026-08-27 11:30:00')

  // `[stacktrace]` is not a header: read as one it is a stamp that sorts after
  // every range, and the scan would stop at the second line of the file
  expect(answer.from).toBeGreaterThan(0)
  expect(answer.to).toBeGreaterThan(answer.from)

  const entries = parse(answer.text.split('\n').filter(one => one !== ''))

  expect(entries.map(one => one.message)).toEqual(['second', 'third'])
})

test('is open-ended where a range does not name an end', () => {
  const answer = run('2026-08-27 11:00:00', '')

  expect(answer.to).toBe(Buffer.byteLength(text))
  expect(parse(answer.text.split('\n').filter(one => one !== '')).length).toBe(3)
})

test('answers with the whole file when no range was asked for', () => {
  const answer = run('', '')

  expect(answer.from).toBe(0)
  expect(answer.to).toBe(Buffer.byteLength(text))
})
