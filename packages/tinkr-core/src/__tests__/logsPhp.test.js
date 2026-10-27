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

const {windowPhp, scanPhp, pagedWindowPhp, scanPagedPhp, parse, read, levels} = require('../logs')

let root = ''
let file = ''
let text = ''
let project = ''
let pageFile = ''
let pagedText = ''
const pagedMessages = Array.from({length: 40}, (unused, at) => `entry ${at} `.padEnd(90, '.'))

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

  // a log long enough to page, kept both where the local read looks and where
  // the generated php is pointed, so the two answers can be the same answer
  pagedText = pagedMessages
    .map((message, at) => {
      const header = line(`2026-08-27 10:${String(at).padStart(2, '0')}:00`, at % 5 === 0 ? 'ERROR' : 'INFO', message)

      return at % 5 === 0 ? `${header}\n#0 frame ${at}` : header
    })
    .join('\n') + '\n'

  pageFile = path.join(root, 'paged.log')
  fs.writeFileSync(pageFile, pagedText)

  project = path.join(root, 'project')
  fs.mkdirSync(path.join(project, 'storage', 'logs'), {recursive: true})
  fs.writeFileSync(path.join(project, 'storage', 'logs', 'paged.log'), pagedText)
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

// run the paginated window builder against a file, and answer with what it printed
const runPagedWindow = (target, bytes, before = null, after = null, since = '', until = '') => {
  const script = path.join(root, 'paged-window.php')

  fs.writeFileSync(script, `<?php ${pagedWindowPhp(target, bytes, before == null ? '$n' : String(before), since, until, after)}`)

  return JSON.parse(execFileSync('php', [script], {encoding: 'utf8'}))
}

// run the paginated scan builder against a region and filter
const runPagedScan = (target, region, filter, forward = false, lower = null) => {
  const script = path.join(root, 'paged-scan.php')

  fs.writeFileSync(script, `<?php ${scanPagedPhp(target, region, filter, forward, lower)}`)

  return JSON.parse(execFileSync('php', [script], {encoding: 'utf8'}))
}

const entriesIn = answer => parse(answer.text.split('\n').filter(one => one !== ''))

test('pages whole entries the way the local read does, backwards and forwards', async () => {
  const local = () => ({path: project, is_over_ssh: false})
  const newest = await read(local(), 'paged.log', {paginate: true, bytes: 1024})
  const newestPhp = runPagedWindow(pageFile, 1024)

  expect(newestPhp.start).toBe(newest.from)
  expect(newestPhp.end).toBe(newest.from + newest.read)
  expect(newestPhp.text.startsWith('[')).toBe(true)
  expect(entriesIn(newestPhp)).toEqual(newest.entries)

  const backward = []
  const phpBackward = []
  let before

  for (;;) {
    const page = await read(local(), 'paged.log', {paginate: true, bytes: 1024, before})
    const got = runPagedWindow(pageFile, 1024, before == null ? null : before)
    const entries = entriesIn(got)

    expect(got.start).toBe(page.from)
    expect(got.end).toBe(page.from + page.read)
    expect(entries).toEqual(page.entries)

    backward.unshift(...page.entries.map(one => one.message))
    phpBackward.unshift(...entries.map(one => one.message))

    if (page.read === 0 || page.from === 0) {
      break
    }

    before = page.from
  }

  expect(backward).toEqual(pagedMessages)
  expect(phpBackward).toEqual(pagedMessages)

  const forward = []
  const phpForward = []
  let after = 0

  for (;;) {
    const page = await read(local(), 'paged.log', {paginate: true, bytes: 1024, after})
    const got = runPagedWindow(pageFile, 1024, null, after)
    const entries = entriesIn(got)

    expect(got.start).toBe(page.from)
    expect(got.end).toBe(page.from + page.read)
    expect(entries).toEqual(page.entries)

    forward.push(...page.entries.map(one => one.message))
    phpForward.push(...entries.map(one => one.message))

    if (page.read === 0) {
      break
    }

    after = page.from + page.read
  }

  expect(forward).toEqual(pagedMessages)
  expect(phpForward).toEqual(pagedMessages)
})

test('reads a completed partial entry again from its header, as the local read does', async () => {
  const local = () => ({path: project, is_over_ssh: false})
  const inProject = path.join(project, 'storage', 'logs', 'overlap.log')
  const beside = path.join(root, 'overlap.log')
  const first = line('2026-08-27 12:00:00', 'INFO', 'first')
  const second = line('2026-08-27 12:01:00', 'INFO', 'second')

  // the second header was written without its colon, so it was not an entry
  const cut = `${first}\n${second.slice(0, second.indexOf(': '))}`

  fs.writeFileSync(inProject, cut)
  fs.writeFileSync(beside, cut)

  const page = await read(local(), 'overlap.log', {paginate: true, bytes: 4096})
  const after = page.from + page.read

  const completed = `${first}\n${second}\n${line('2026-08-27 12:02:00', 'INFO', 'third')}\n`

  fs.writeFileSync(inProject, completed)
  fs.writeFileSync(beside, completed)

  const next = await read(local(), 'overlap.log', {paginate: true, bytes: 4096, after})
  const got = runPagedWindow(beside, 4096, null, after)

  expect(next.from).toBeLessThan(after)
  expect(next.entries.map(one => one.message)).toEqual(['second', 'third'])
  expect(got.start).toBe(next.from)
  expect(got.end).toBe(next.from + next.read)
  expect(entriesIn(got)).toEqual(next.entries)

  // a continuation appended to an entry that ended exactly at the old EOF is
  // the same entry read again, not a detached line of its own
  const header = line('2026-08-27 12:00:00', 'ERROR', 'boom')
  const partial = `${header}\n#0 frame one`

  fs.writeFileSync(inProject, partial)
  fs.writeFileSync(beside, partial)

  const before = await read(local(), 'overlap.log', {paginate: true, bytes: 4096})
  const cursor = before.from + before.read

  const continued = `${partial}\n#1 frame two`

  fs.writeFileSync(inProject, continued)
  fs.writeFileSync(beside, continued)

  const again = await read(local(), 'overlap.log', {paginate: true, bytes: 4096, after: cursor})
  const continuedPhp = runPagedWindow(beside, 4096, null, cursor)

  expect(again.from).toBe(0)
  expect(again.entries[0].details).toBe('#0 frame one\n#1 frame two')
  expect(continuedPhp.start).toBe(again.from)
  expect(continuedPhp.end).toBe(again.from + again.read)
  expect(entriesIn(continuedPhp)).toEqual(again.entries)
})

test('filters and pages the way the local read does', async () => {
  const local = () => ({path: project, is_over_ssh: false})
  const region = {from: 0, to: Buffer.byteLength(pagedText)}
  const filter = {levels: [], exclude: [], term: 'entry 1', limit: 3}

  const newest = await read(local(), 'paged.log', {paginate: true, term: 'entry 1', limit: 3})
  const newestPhp = runPagedScan(pageFile, region, filter, false)

  expect(newestPhp.entries).toEqual(newest.entries)
  expect(newestPhp.from).toBe(newest.from)
  expect(newestPhp.to).toBe(newest.to)
  expect(newestPhp.older).toBe(newest.older)

  const older = await read(local(), 'paged.log', {paginate: true, term: 'entry 1', limit: 3, before: newest.from})
  const olderPhp = runPagedScan(pageFile, {from: 0, to: newest.from}, filter, false)

  expect(olderPhp.entries).toEqual(older.entries)
  expect(olderPhp.from).toBe(older.from)
  expect(olderPhp.to).toBe(older.to)
  expect(olderPhp.older).toBe(older.older)

  const forward = await read(local(), 'paged.log', {paginate: true, term: 'entry 1', limit: 3, after: 0})
  const forwardPhp = runPagedScan(pageFile, region, filter, true)

  expect(forwardPhp.entries).toEqual(forward.entries)
  expect(forwardPhp.from).toBe(forward.from)
  expect(forwardPhp.to).toBe(forward.to)
})

test('keeps unformatted lines when every known level is excluded, as the local read does', async () => {
  const local = () => ({path: project, is_over_ssh: false})
  const inProject = path.join(project, 'storage', 'logs', 'mixed.log')
  const beside = path.join(root, 'mixed.log')
  const mixed = `a line that starts no entry\n${line('2026-08-27 10:00:00', 'ERROR', 'bad')}\n${line('2026-08-27 10:01:00', 'INFO', 'good')}\n`

  fs.writeFileSync(inProject, mixed)
  fs.writeFileSync(beside, mixed)

  const answer = await read(local(), 'mixed.log', {paginate: true, excludeLevels: levels})
  const got = runPagedScan(beside, {from: 0, to: Buffer.byteLength(mixed)}, {levels: [], exclude: levels, term: '', limit: 100}, false)

  expect(answer.entries.map(one => one.message)).toEqual(['a line that starts no entry'])
  expect(got.entries).toEqual(answer.entries)
  expect(got.from).toBe(answer.from)
  expect(got.to).toBe(answer.to)
})

test('reads a multi-byte character crossing a read chunk the way the local read does', async () => {
  const local = () => ({path: project, is_over_ssh: false})
  const inProject = path.join(project, 'storage', 'logs', 'wide.log')
  const beside = path.join(root, 'wide.log')
  const header = line('2026-08-27 12:00:00', 'ERROR', 'wide')
  const pad = 'x'.repeat(65536 - Buffer.byteLength(header) - 2)
  const details = `${pad}é${'y'.repeat(200)}`
  const wide = `${header}\n${details}\n${line('2026-08-27 12:01:00', 'INFO', 'after')}\n`

  fs.writeFileSync(inProject, wide)
  fs.writeFileSync(beside, wide)

  const answer = await read(local(), 'wide.log', {paginate: true, term: 'wide', limit: 1})
  const got = runPagedScan(beside, {from: 0, to: Buffer.byteLength(wide)}, {levels: [], exclude: [], term: 'wide', limit: 1}, false)

  expect(answer.entries).toHaveLength(1)
  expect(answer.entries[0].details).toBe(details)
  expect(got.entries).toEqual(answer.entries)
  expect(got.from).toBe(answer.from)
  expect(got.to).toBe(answer.to)
})

test('finds a newly matching completed tail in real PHP and local reads', async () => {
  const local = () => ({path: project, is_over_ssh: false})
  const inProject = path.join(project, 'storage', 'logs', 'filtered-overlap.log')
  const beside = path.join(root, 'filtered-overlap.log')
  const filter = {levels: [], exclude: [], term: 'needle', limit: 100}
  const first = `${line('2026-08-27 10:00:00', 'ERROR', 'prior needle')}\n`
  const tail = `${line('2026-08-27 10:01:00', 'INFO', 'new tail')}\n#0 partial`
  fs.writeFileSync(inProject, first + tail)
  fs.writeFileSync(beside, first + tail)

  const page = await read(local(), 'filtered-overlap.log', {paginate: true, term: 'needle'})
  const after = page.from + page.read
  fs.appendFileSync(inProject, ' needle complete\n')
  fs.appendFileSync(beside, ' needle complete\n')

  const next = await read(local(), 'filtered-overlap.log', {paginate: true, term: 'needle', after})
  const got = runPagedScan(beside, {from: after, to: fs.statSync(beside).size}, filter, true, 0)

  expect(next.entries.map(one => one.message)).toEqual(['new tail'])
  expect(next.entries[0].details).toBe('#0 partial needle complete')
  expect(got.entries).toEqual(next.entries)
  expect(got.from).toBe(Buffer.byteLength(first))
  expect(got.to).toBe(next.to)
})
