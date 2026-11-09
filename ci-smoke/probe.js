// Throwaway: what a real cmd.exe does with each quoting rule, and what the
// session's boot and a very large line put on the pty.
const {spawnSync} = require('child_process')
const path = require('path')
const pty = require('node-pty')

const {Session} = require('../packages/tinkr-core/src/session')
const {RunResultFilter, wrapRun, typedRun} = require('../packages/tinkr-core/src/runResult')

const app = process.env.APP
const nodeExe = process.execPath
const argvScript = path.join(__dirname, 'argv.js')
const show = (value, limit = 400) => JSON.stringify(String(value).slice(0, limit))

// --- encodings ---------------------------------------------------------------

// the MSVC CRT form: backslashes before a quote doubled, the quote escaped with
// a backslash, trailing backslashes doubled, wrapped in quotes
const crt = value => {
  const text = String(value)
  let out = '"'
  let slashes = 0

  for (const char of text) {
    if (char === '\\') {
      slashes++
      out += char
      continue
    }

    if (char === '"') {
      out += `${'\\'.repeat(slashes)}\\"`
      slashes = 0
      continue
    }

    slashes = 0
    out += char
  }

  return `${out}${'\\'.repeat(slashes)}"`
}

const META = /([()%!^"`<>&|;, *?[\]])/g
const META_NO_BANG = /([()%^"`<>&|;, *?[\]])/g
const caret = value => String(value).replace(META, '^$&')
const caretNoBang = value => String(value).replace(META_NO_BANG, '^$&')
const caretDelay = value => caretNoBang(value).replace(/!/g, '^^!')

const variants = {
  crt,
  caretCrt: value => caret(crt(value)),
  caretDelayCrt: value => caretDelay(crt(value)),
  caretNoBangCrt: value => caretNoBang(crt(value)),
  caretRaw: value => caret(value),
}

const words = [
  'plain', 'with space', 'quote"inside', "single'q", '%PATH%', '!bang!',
  'a&b|c<d>e(f)', 'caret^x', 'ünïcødé', 'trail\\', 'comma,semi;eq=', '',
  'back\\slash\\two', 'end"', 'tick`x', '[x]y', '100%', 'C:\\100%\\bin',
  'two  spaces', '=eq', '*star?q', '%', '!', '"', '\\', 'a!b%c^d&e',
]

const line = (encode, list = words) => `${crt(nodeExe)} ${crt(argvScript)} ${list.map(encode).join(' ')}`

const parseArgs = text => {
  const match = String(text).split(/\r?\n/).reverse().find(part => part.trim().startsWith('['))

  try {
    return JSON.parse(String(match || '').trim())
  } catch (e) {
    return null
  }
}

const compare = (name, got) => {
  const same = JSON.stringify(got) === JSON.stringify(words)
  const bad = words.map((word, at) => (got && got[at] === word ? null : {at, word, got: got ? got[at] : null})).filter(Boolean)
  const count = got ? got.length : -1

  console.log(`${same ? 'SAME' : 'DIFF'} ${name} (${count}/${words.length}) ${bad.length ? show(JSON.stringify(bad)) : ''}`)
}

const section = title => console.log(`\n=== ${title}`)

// --- /c ---------------------------------------------------------------------

const throughC = () => {
  section('cmd /d /s /c')

  for (const [name, encode] of Object.entries(variants)) {
    const result = spawnSync(process.env.ComSpec, ['/d', '/s', '/c', `"${line(encode)}"`], {
      windowsVerbatimArguments: true,
      cwd: app,
      encoding: 'utf8',
      timeout: 30000,
    })

    compare(name, parseArgs(result.stdout))

    if (!parseArgs(result.stdout)) {
      console.log(`  no argv for ${name}: ${show(`${result.stdout}${result.stderr}`, 600)}`)
    }
  }
}

// --- typed into a cmd /V:ON ------------------------------------------------

const throughTyped = async () => {
  section('typed into cmd /V:ON')

  const typed = pty.spawn(process.env.ComSpec, ['/V:ON'], {
    useConpty: false,
    cols: 400,
    rows: 40,
    cwd: app,
    env: process.env,
  })

  let buffer = ''
  let seen = 0

  typed.onData(data => {
    buffer += data
  })

  const waitFor = async text => {
    const until = Date.now() + 15000

    while (Date.now() < until && !buffer.includes(text)) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    return buffer.includes(text)
  }

  for (const [name, encode] of Object.entries(variants)) {
    buffer = ''
    const end = `~~END${seen++}~~`

    typed.write(`${line(encode)} & echo ${end}\r`)

    const answered = await waitFor(end)

    if (!answered) {
      console.log(`DIFF ${name} (no answer) ${show(buffer, 600)}`)

      continue
    }

    compare(name, parseArgs(buffer.slice(0, buffer.lastIndexOf(end))))
  }

  typed.kill()
}

// --- the boot ---------------------------------------------------------------

const boot = async () => {
  section('boot')

  const session = new Session({id: 'probe', path: app}, {})
  const raw = []

  session.start('php artisan tinker')

  if (!session.pty) {
    console.log('no pty')

    return null
  }

  session.pty.onData(data => raw.push(data))

  const started = Date.now()
  const ready = await session.ready().then(() => 'ready', error => `failed: ${error.message}`)
  const text = raw.join('')

  console.log(`boot ${ready} in ${Date.now() - started} ms, ${text.length} bytes`)
  console.log(`boot-banner ${/Psy Shell v/.test(text)} boot-prompt ${/(?:^|[\r\n])(?:>>>|>|\.\.\.|\.) $/.test(text)}`)
  console.log(`boot-raw ${show(text, 4000)}`)

  return session
}

// --- a very large line ------------------------------------------------------

const big = async session => {
  section('2 MB echo')

  const run = wrapRun('echo str_repeat("x", 2000000); 7')
  const filter = new RunResultFilter(run.marker, run.start)
  let chunks = 0
  let largest = 0
  let total = 0
  let result = null
  let startedAt = null

  session.pty.onData(data => {
    chunks++
    total += data.length
    largest = Math.max(largest, data.length)

    const pushed = filter.push(data)

    if (pushed.result) {
      result = pushed.result
    }

    if (filter.started && startedAt === null) {
      startedAt = chunks
      console.log(`  started at chunk ${chunks}, ${total} bytes in`)
    }
  })

  const typedAt = Date.now()

  session.type(typedRun(run.code)).catch(() => {})

  await new Promise(resolve => {
    const until = Date.now() + 90000

    const poll = () => {
      if (result || Date.now() > until) {
        resolve()

        return
      }

      setTimeout(poll, 50)
    }

    poll()
  })

  const printed = filter.printedText()
  const xs = (printed.match(/x/g) || []).length

  console.log(`big in ${Date.now() - typedAt} ms: chunks ${chunks} largest ${largest} total ${total}`)
  console.log(`big filter: started ${filter.started} asked ${filter.asked} typing ${filter.typing} done ${filter.done}`)
  console.log(`big printed ${printed.length} (x ${xs}) early ${filter.early.length} value ${show(JSON.stringify(result && result.value))}`)
  console.log(`big printed head ${show(printed, 120)} tail ${show(printed.slice(-120), 120)}`)
}

;(async () => {
  throughC()

  await throughTyped()

  const session = await boot()

  if (session) {
    await big(session)

    session.kill()
  }

  console.log('\nprobe done')
  process.exit(0)
})()
