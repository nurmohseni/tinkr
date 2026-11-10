// Throwaway: drives the real command layer on a real cmd.exe.
const fs = require('fs')
const path = require('path')

const {spawnSync} = require('child_process')
const pty = require('node-pty')

const {exec} = require('../packages/tinkr-core/src/remote')
const {shellQuote} = require('../packages/tinkr-core/src/shell')
const {wrapRun, typedRun} = require('../packages/tinkr-core/src/runResult')

const app = process.env.APP
let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' :: ' + JSON.stringify(detail).slice(0, 12000)}`)
  if (!ok) failed++
}

const words = ['plain', 'with space', 'quote"inside', "single'q", '%PATH%', '!bang!', 'a&b|c<d>e(f)', 'caret^x', 'ünïcødé', 'trail\\', 'comma,semi;eq=', '100% !bang! ^caret', 'C:\\srv\\100%\\a!b^c', '']

// a word as the shell of a session reads it: cmd started with /V:ON, which is
// where a `!` takes one caret more than it does in a `/c` line
const throughTypedShell = async (list, encode) => {
  const terminal = pty.spawn(process.env.ComSpec, ['/V:ON'], {
    cols: 2000, rows: 60, cwd: app, env: process.env,
  })
  let buffer = ''

  terminal.onData(data => { buffer += data })

  const end = '~~SMOKE-END~~'
  const argvScript = path.join(__dirname, 'argv.js')
  const out = path.join(app, 'typed-argv.json')
  const line = `${shellQuote(process.execPath, 'win32', {delayed: true})} ${shellQuote(argvScript, 'win32', {delayed: true})} --out ${shellQuote(out, 'win32', {delayed: true})} ${list.map(encode).join(' ')}`

  try { fs.unlinkSync(out) } catch (e) {}

  terminal.write(`${line} & echo ${end}\r`)

  // the console echoes a typed line before cmd runs it, so the marker arrives
  // twice: once as part of the line it was typed in, and once as what the shell
  // prints after the command has written its file. Waiting for the first is
  // waiting for the echo, which is the moment before anything has run — the
  // file is still absent and the run is read as one that answered nothing
  const marks = () => buffer.split(end).length - 1
  const until = Date.now() + 30000

  while (Date.now() < until && marks() < 2) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  terminal.kill()

  // the whole terminal is kept: a run that printed nothing says why in the
  // prompt that came back and in the line that is still sitting there
  try {
    return {got: JSON.parse(fs.readFileSync(out, 'utf8')), part: buffer}
  } catch (e) {
    return {got: null, part: buffer}
  }
}

;(async () => {
  // --- quoting ---------------------------------------------------------------

  const printer = `node -e ${shellQuote('console.log(JSON.stringify(process.argv.slice(1)))', 'win32')} ${words.map(w => shellQuote(w, 'win32')).join(' ')}`
  const read = await exec({path: app}, printer, {timeout: 30000})
  let got = null
  try { got = JSON.parse(String(read.stdout || read.output || '').trim().split('\n').pop()) } catch (e) {}
  check('cmd quoting round trip through remote.exec', JSON.stringify(got) === JSON.stringify(words), {words, read})

  // a variable that was never set here, and a percent that is part of no name:
  // both a caret escape has to hand to the program as they were written
  const undefinedVariable = '__TINKR_SMOKE_UNDEFINED__'
  const phpCode = `echo json_encode(["a" => "%${undefinedVariable}%", "b" => "100%", "c" => "x&y", "d" => "it's", "e" => "a b"]);`
  const phpRead = await exec({path: app}, `php -r ${shellQuote(phpCode, 'win32')}`, {timeout: 30000})
  check('php -r through cmd keeps %, & and quotes', String(phpRead.stdout || '').includes(`{"a":"%${undefinedVariable}%","b":"100%","c":"x&y","d":"it's","e":"a b"}`), phpRead)

  // a path of the machine's that holds what cmd expands, as a word of a line
  const oddWord = 'C:\\100%\\a!b&c^d'
  const odd = await exec({path: app}, `node ${shellQuote(path.join(__dirname, 'argv.js'), 'win32')} ${shellQuote(oddWord, 'win32')}`, {timeout: 30000})
  let oddGot = null
  try { oddGot = JSON.parse(String(odd.stdout || '').trim().split('\n').pop()) } catch (e) {}
  check('a path with % ! & ^ survives the line', JSON.stringify(oddGot) === JSON.stringify([oddWord]), {oddWord, odd})

  // --- the floor -------------------------------------------------------------
  //
  // before any of the app's own waits: what php itself costs on this runner, and
  // what cmd plus psysh cost when nothing of the session's logic is involved

  const timed = label => {
    const at = Date.now()
    const child = spawnSync(label, {shell: true, cwd: app, encoding: 'utf8', timeout: 120000})

    return {ms: Date.now() - at, status: child.status, out: `${child.stdout || ''}${child.stderr || ''}`.trim().slice(0, 200)}
  }

  const bare = timed('php -r 1;')
  check(`floor php -r (${bare.ms} ms)`, bare.status === 0, bare)
  const artisan = timed('php artisan --version')
  check(`floor php artisan --version (${artisan.ms} ms)`, artisan.status === 0 && /Laravel Framework/.test(artisan.out), artisan)

  // the same boot the session waits on, with none of the session's code: cmd with
  // delayed expansion, the command typed into it, and the prompt it comes back with
  const bootFloor = async () => {
    const at = Date.now()
    const terminal = pty.spawn(process.env.ComSpec, ['/V:ON'], {cwd: app, env: process.env})
    let buffer = ''
    let bannerAt = null
    let promptAt = null

    terminal.onData(data => {
      buffer += data

      if (bannerAt === null && /Psy Shell/.test(buffer)) bannerAt = Date.now() - at
      if (promptAt === null && bannerAt !== null && /(?:^|[\r\n])> $/.test(buffer.slice(-256))) promptAt = Date.now() - at
    })

    terminal.write('php artisan tinker\r')

    const until = Date.now() + 60000
    while (Date.now() < until && promptAt === null) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }

    terminal.kill()

    return {ms: Date.now() - at, bannerAt, promptAt, cols: terminal.cols, tail: buffer.slice(-400)}
  }

  const boot = await bootFloor()
  check(`floor cmd + php artisan tinker prompt (${boot.ms} ms, banner ${boot.bannerAt} ms, prompt ${boot.promptAt} ms)`, boot.promptAt !== null, boot)

  // --- what the typing costs -------------------------------------------------
  //
  // a run is 41 lines of base64 for a one-line snippet, and the console echoes
  // every character of it back through conpty: this measures what that echo
  // costs when the lines are handed over in one write, in fours, and one at a
  // time, and whether the console takes the whole run in a single write at all

  const nap = ms => new Promise(resolve => setTimeout(resolve, ms))

  const typedProbe = async (batch) => {
    const at = Date.now()
    const run = wrapRun('1 + 1')
    const lines = typedRun(run.code)
    const terminal = pty.spawn(process.env.ComSpec, ['/V:ON'], {cwd: app, env: process.env})
    const state = {buffer: '', bannerAt: null, promptAt: null, answeredAt: null, chunks: 0, bytes: 0}

    terminal.onData(data => {
      state.chunks += 1
      state.bytes += data.length
      state.buffer += data

      if (state.bannerAt === null && /Psy Shell/.test(state.buffer)) state.bannerAt = Date.now() - at
      if (state.promptAt === null && state.bannerAt !== null && /(?:^|[\r\n])> $/.test(state.buffer.slice(-256))) state.promptAt = Date.now() - at
      if (state.answeredAt !== null) return
      const found = state.buffer.indexOf(run.marker)
      const opens = found === -1 ? -1 : state.buffer.indexOf('@', found + run.marker.length)
      const closes = opens === -1 ? -1 : state.buffer.indexOf('@', opens + 1)
      if (closes !== -1) state.answeredAt = Date.now() - at
    })

    terminal.write('php artisan tinker\r')

    const until = Date.now() + 60000
    while (Date.now() < until && state.promptAt === null) await nap(10)

    const typedAt = Date.now()
    let writtenAt = null
    for (let at2 = 0; at2 < lines.length; at2 += batch) {
      terminal.write(lines.slice(at2, at2 + batch).map(line => `${line}\r`).join(''))
      writtenAt = Date.now()
    }

    while (Date.now() < until && state.answeredAt === null) await nap(10)

    // the answer is read back out of the stream the way the filter reads it: the
    // base64 between the two `@`, with whatever the console rendered into it cut
    let value = null
    const found = state.buffer.indexOf(run.marker)
    const opens = found === -1 ? -1 : state.buffer.indexOf('@', found + run.marker.length)
    const closes = opens === -1 ? -1 : state.buffer.indexOf('@', opens + 1)
    if (closes !== -1) {
      const payload = state.buffer.slice(opens + 1, closes).replace(/[^A-Za-z0-9+/=]/g, '')
      try { value = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).value } catch (e) { value = `payload ${payload.length}` }
    }
    terminal.kill()

    return {
      batch,
      lines: lines.length,
      bytesTyped: lines.reduce((sum, line) => sum + line.length + 1, 0),
      ms: Date.now() - at,
      bootAt: state.promptAt,
      writeAt: writtenAt === null ? null : writtenAt - typedAt,
      answeredAt: state.answeredAt === null ? null : state.answeredAt - typedAt,
      chunks: state.chunks,
      echoed: state.bytes,
      value,
    }
  }

  for (const size of [1000, 8, 1]) {
    const probe = await typedProbe(size)
    const how = size === 1 || size === 8 ? `in ${size}s` : 'in one write'
    check(`typing ${probe.lines} lines ${how} (${probe.ms} ms, echo ${probe.echoed} bytes in ${probe.chunks} chunks, write ${probe.writeAt} ms, answer ${probe.answeredAt} ms)`, probe.value === 2, probe)
  }

  // --- a session -------------------------------------------------------------
  //
  // each run in a process of its own: what a run answers must be its own doing,
  // and a run that answers nothing reports the tail of its terminal with it

  const runOne = async (code, timeout) => {
    const started = Date.now()
    const traceFile = path.join(app, 'timeline.json')
    try { fs.unlinkSync(traceFile) } catch (e) {}
    const child = spawnSync(process.execPath, [path.join(__dirname, 'runone.js'), code], {
      cwd: app,
      env: Object.assign({}, process.env, {APP: app, RUN_TIMEOUT: String(timeout), TRACE: traceFile}),
      encoding: 'utf8',
      timeout: timeout + 120000,
    })
    // the timeline is printed for every run: it is how a slow one says where
    // its seconds went without the run's own output being cut
    let timeline = []
    try { timeline = JSON.parse(fs.readFileSync(traceFile, 'utf8')) } catch (e) {}
    console.log(`TIMELINE ${JSON.stringify(code)}`)
    timeline.forEach(([at, event, detail]) => console.log(`  ${String(at).padStart(7)} ${event} ${detail}`))
    const text = `${child.stdout || ''}${child.stderr || ''}`
    const line = text.split(/\r?\n/).reverse().find(part => /^(?:RESULT|ERROR) \{/.test(part))
    let seen = null
    try { seen = line ? JSON.parse(line.slice(line.indexOf(' '))) : null } catch (e) {}
    const tail = seen ? seen.raw.slice(-1200) : text.slice(-1200)

    return {ms: Date.now() - started, seen, tail, status: child.status}
  }

  const valueOf = run => (run.seen ? run.seen.value : undefined)
  const outputOf = run => String((run.seen && run.seen.output) || '')
  // runone keeps 400 characters of the output for the report and its length in
  // whole, so a line of 70000 characters is measured without being carried
  const outputLength = run => (run.seen && typeof run.seen.len === 'number' ? run.seen.len : outputOf(run).length)

  let x = await runOne('1 + 1', 90000)
  check(`runCode value (${x.ms} ms)`, valueOf(x) === 2, {status: x.status, seen: x.seen, tail: x.tail})

  x = await runOne('1 + 2', 30000)
  check(`runCode second value (${x.ms} ms)`, valueOf(x) === 3, {status: x.status, seen: x.seen, tail: x.tail})

  x = await runOne(`$s = "it's \\"q\\" $"; echo "printed\\n"; $s`, 30000)
  check('runCode quotes + echo', valueOf(x) === `it's "q" $` && /printed/.test(outputOf(x)), {status: x.status, seen: x.seen, tail: x.tail})

  x = await runOne("throw new RuntimeException('boom');", 30000)
  const thrown = x.seen && x.seen.value ? x.seen.value : (x.seen && x.seen.error)
  check('runCode exception with line', !!(thrown && thrown.message === 'boom' && thrown.line === 1), {status: x.status, seen: x.seen, tail: x.tail})

  x = await runOne('echo "a\\nb"; 1', 30000)
  check('runCode small echo', valueOf(x) === 1 && outputOf(x).trim() === 'a\nb', {status: x.status, seen: x.seen, tail: x.tail})

  x = await runOne('echo str_repeat("y", 70000); 2', 30000)
  check(`runCode 64 KB line (${x.ms} ms)`, valueOf(x) === 2 && outputLength(x) >= 70000, {status: x.status, seen: x.seen, tail: x.tail})

  x = await runOne('echo str_repeat("x", 2000000); 7', 120000)
  check(`runCode 2 MB echo (${x.ms} ms)`, valueOf(x) === 7 && outputLength(x) >= 2000000, {status: x.status, seen: {value: valueOf(x), len: outputLength(x)}, tail: x.tail})

  x = await runOne('range(1, 300)', 30000)
  check('runCode tall value (no pager)', Array.isArray(valueOf(x)) && valueOf(x).length === 300, {status: x.status, seen: x.seen, tail: x.tail})

  x = await runOne('sleep(60); 1', 10000)
  check(`runCode timeout ends the run (${x.ms} ms)`, !!(x.seen && x.seen.message) && x.ms < 40000, {status: x.status, seen: x.seen, tail: x.tail})

  // --- the shell a session types into ----------------------------------------
  //
  // last, because a terminal that a run left behind is not what this measures

  const typed = await throughTypedShell(words, word => shellQuote(word, 'win32', {delayed: true}))
  check('cmd quoting round trip through the session shell (/V:ON)', JSON.stringify(typed.got) === JSON.stringify(words), {words, got: typed.got, part: typed.part.slice(-1500)})

  console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
  process.exit(failed ? 1 : 0)
})()
