// Throwaway: what conpty hands over for the envelope a run prints, and what the
// filter makes of it.
//
// The run executes on windows — its output reaches the pane — but no answer
// comes back, and the answer is the one line `<start><marker>@<base64>@` the
// wrapper prints. This prints the bytes of that line as they arrived, escaped,
// and then runs the app's own RunResultFilter over the same bytes, so whether
// the marker is read, whether the payload parses, and what the terminal did to
// either is answered by the console rather than by reasoning about conpty.
//
// The code is typed base64-encoded the way a run is, so the echo of the line
// never holds the marker and the stream is the shape a real run has.
const pty = require('node-pty')

const {RunResultFilter, parseResult} = require('../packages/tinkr-core/src/runResult')
const {stripRendering} = require('../packages/tinkr-core/src/terminalOutput')

const app = process.env.APP
const terminal = pty.spawn(process.env.ComSpec, ['/V:ON'], {
  cols: 80, rows: 24, cwd: app, env: process.env, useConpty: true,
})

let raw = ''

terminal.onData(data => { raw += data })

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// what a run types: the base64 of php that prints the start marker and then the
// envelope, on one line
const envelope = (start, mark, value) => {
  const php = `echo '${start}';echo '${mark}',"@",base64_encode(json_encode(['blocks'=>[],'value'=>${value},'error'=>null])),"@";`
  const encoded = Buffer.from(php, 'utf8').toString('base64')

  return {php, line: `echo eval(base64_decode('${encoded}'));`, encoded}
}

const show = text => JSON.stringify(text).slice(-3500)

;(async () => {
  await wait(1500)
  terminal.write('php artisan tinker\r')

  // the banner and the first prompt are what say psysh is reading
  const until = Date.now() + 90000

  while (Date.now() < until) {
    const shown = stripRendering(raw)

    if (/Psy Shell/.test(shown) && /(?:^|[\r\n])>>> ?$/.test(shown)) {
      break
    }

    await wait(100)
  }

  let booted = raw.length

  const cases = [
    ['STRTAAAAAAAAAAAA', 'TINKRBBBBBBBBBBBB', '2'],
    // the envelope of a tall value, which is wider than the console
    ['STRTCCCCCCCCCCCC', 'TINKRDDDDDDDDDDDD', 'str_repeat("A",400)'],
  ]

  for (const [start, mark, value] of cases) {
    const {line, php} = envelope(start, mark, value)

    terminal.write(`${line}\r`)
    await wait(5000)
    const part = raw.slice(booted)

    console.log(`== ${mark} ==`)
    console.log('php', show(php))
    console.log('bytes', show(part))

    const at = part.indexOf(mark)
    const open = part.indexOf(`${mark}@`)

    console.log('mark-at', at, 'open', open)

    if (open !== -1) {
      const rest = part.slice(open + mark.length + 1)
      const close = rest.indexOf('@')
      const payload = rest.slice(0, close)

      console.log('payload', show(payload))
      console.log('parsed', JSON.stringify(parseResult(payload)))
    }

    const filter = new RunResultFilter(mark, start)
    const out = filter.push(part)

    console.log('filter', JSON.stringify({
      result: out.result,
      started: filter.started,
      asked: filter.asked,
      typing: filter.typing,
      done: filter.done,
      printed: String(filter.printedText()).slice(0, 120),
    }))

    // the next case starts from here, so only the new bytes are read
    booted = raw.length
  }

  terminal.kill()

  // --- the real run, in a session of its own --------------------------------
  //
  // the same bytes a run produces, from the app's own code: what follows the
  // echo of the typed run is where the wrapper's output should be
  const kept = []
  const original = pty.spawn

  pty.spawn = (shell, args, options) => {
    const session = original(shell, args, options)

    kept.push([])
    session.onData(data => kept[kept.length - 1].push(data))

    return session
  }

  const {runCode} = require('../packages/tinkr-core/src/session')

  try {
    const result = await runCode({id: 'probe', path: app, command: 'php artisan tinker'}, '1 + 1', {timeout: 25000})

    console.log('runCode value', JSON.stringify(result.value))
  } catch (e) {
    console.log('runCode error', e.message)
  }

  const text = kept.map(record => record.join('')).join('')
  const end = text.lastIndexOf('/*tinkr:end*/')
  const starts = text.match(/STRT[0-9A-F]{12}/g) || []
  const marks = text.match(/TINKR[0-9A-F]{12}/g) || []

  console.log('run bytes', text.length, 'end-at', end)
  console.log('run start markers', JSON.stringify(starts), 'value markers', JSON.stringify(marks))
  console.log('run after echo', show(end === -1 ? text : text.slice(end)))
  console.log('run head of echo', show(text.slice(0, 1500)))

  process.exit(0)
})()
