// Throwaway: drives the real command layer on a real cmd.exe.
const fs = require('fs')
const path = require('path')

const {spawnSync} = require('child_process')
const pty = require('node-pty')

const {exec} = require('../packages/tinkr-core/src/remote')
const {shellQuote} = require('../packages/tinkr-core/src/shell')

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

  // --- a session -------------------------------------------------------------
  //
  // each run in a process of its own: what a run answers must be its own doing,
  // and a run that answers nothing reports the tail of its terminal with it

  const runOne = async (code, timeout) => {
    const started = Date.now()
    const child = spawnSync(process.execPath, [path.join(__dirname, 'runone.js'), code], {
      cwd: app,
      env: Object.assign({}, process.env, {APP: app, RUN_TIMEOUT: String(timeout)}),
      encoding: 'utf8',
      timeout: timeout + 120000,
    })
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
