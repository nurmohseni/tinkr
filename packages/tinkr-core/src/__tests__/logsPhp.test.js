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

const {windowPhp, scanPhp, parse} = require('../logs')

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

// one window onto the whole fixture, scanned by the php the service builds
const scan = (filter, region = null) => {
  const script = path.join(root, 'scan.php')

  fs.writeFileSync(script, `<?php ${scanPhp(file, region || {from: 0, to: Buffer.byteLength(text)}, filter)}`)

  return JSON.parse(execFileSync('php', [script], {encoding: 'utf8'}))
}

test('is scan php that parses', () => {
  const script = path.join(root, 's.php')

  fs.writeFileSync(script, `<?php ${scanPhp(file, {from: 0, to: 1024}, {levels: ['error'], term: 'no', limit: 10})}`)

  expect(() => execFileSync('php', ['-l', script], {encoding: 'utf8', stdio: 'pipe'})).not.toThrow()
})

test('reads the same entries the local parse reads', () => {
  const answer = scan({levels: [], term: '', limit: 100})
  const lines = text.split('\n').filter(one => one !== '')

  expect(answer.size).toBe(Buffer.byteLength(text))
  expect(answer.entries).toEqual(parse(lines))
  expect(answer.older).toBe(0)
})

test('keeps what a filter matches, and how many older matches there were', () => {
  const errors = scan({levels: ['error'], term: '', limit: 10})

  expect(errors.entries.map(one => one.message)).toEqual(['first'])
  expect(errors.entries[0].details).toContain('#0 /app/a.php(1): go()')

  // the newest matches are kept, and the ones that fell off are counted
  const newest = scan({levels: [], term: '', limit: 2})

  expect(newest.entries.map(one => one.message)).toEqual(['third', 'fourth'])
  expect(newest.older).toBe(2)

  // a term is looked for anywhere in the entry, without case
  expect(scan({levels: [], term: 'THIRD', limit: 10}).entries.map(one => one.message)).toEqual(['third'])
})

test('drops the tail of a line a region starts in the middle of', () => {
  const third = text.indexOf('[2026-08-27 11:30:00]')

  // five bytes into the third header is inside the line, so that line is the
  // tail of one already read and the entry after it is all this region holds
  const answer = scan({levels: [], term: '', limit: 10}, {from: third + 5, to: Buffer.byteLength(text)})

  expect(answer.entries.map(one => one.message)).toEqual(['fourth'])
})

test('reads a json log the way the local parse reads it', () => {
  const json = {
    message: 'boom',
    context: {order: 7, path: '/app/Orders.php'},
    level: 400,
    level_name: 'ERROR',
    channel: 'local',
    datetime: '2026-08-27T11:10:53.000000+00:00',
  }

  const line = JSON.stringify(json)
  const jsonFile = path.join(root, 'json.log')

  fs.writeFileSync(jsonFile, `${line}\n`)

  const script = path.join(root, 'json.php')

  fs.writeFileSync(script, `<?php ${scanPhp(jsonFile, {from: 0, to: Buffer.byteLength(line) + 1}, {levels: [], term: '', limit: 10})}`)

  const answer = JSON.parse(execFileSync('php', [script], {encoding: 'utf8'}))

  expect(answer.entries).toEqual(parse([line]))
})
