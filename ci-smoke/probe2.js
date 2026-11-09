// Throwaway: the winpty backend against the conpty one, on a real cmd.exe.
//
// The parent runs each backend in a child of its own, so a deadlock in spawn is a
// timeout to report rather than a job that never ends. The child answers:
//
// - the quoting matrix typed into a `cmd /V:ON`, wide enough not to wrap
// - the first `runCode` of a job, with the raw pty stream kept, which is the run
//   that does not answer
// - the boot of a session, with what it printed and how long it took to be ready
// - a 2 MB echo, and what of it the filter kept
const {spawnSync} = require('child_process')
const path = require('path')
const ptyModule = require('node-pty')

const app = process.env.APP
const nodeExe = process.execPath
const argvScript = path.join(__dirname, 'argv.js')
const show = (value, limit = 800) => JSON.stringify(String(value).slice(0, limit))

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

const META = /([()%^"`<>&|;, *?[\]])/g
const META_NO_BANG = /([()%^"`<>&|;, *?[\]])/g
const caretDelay = value => String(value).replace(META_NO_BANG, '^$&').replace(/!/g, '^^!')
const caretPlain = value => String(value).replace(META, '^$&')

const words = [
  'plain', 'with space', 'quote"inside', "single'q", '%PATH%', '!bang!',
  'a&b|c<d>e(f)', 'caret^x', 'ünïcødé', 'trail\\', 'comma,semi;eq=', '',
  'back\\slash\\two', 'end"', 'tick`x', '[x]y', '100%', 'C:\\100%\\bin',
  'two  spaces', '=eq', '*star?q', '%', '!', '"', '\\', 'a!b%c^d&e',
]

const line = encode => `${crt(nodeExe)} ${crt(argvScript)} ${words.map(encode).join(' ')}`

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

  console.log(`${same ? 'SAME' : 'DIFF'} ${name} (${got ? got.length : -1}/${words.length}) ${bad.length ? show(JSON.stringify(bad), 600) : ''}`)
}

const section = title => console.log(`\n=== ${title}`)

const child = useConpty => {
  const kept = []
  const original = ptyModule.spawn

  ptyModule.spawn = (shell, args, options) => {
    const terminal = original(shell, args, Object.assign({}, options, {useConpty}))
    const record = []

    kept.push(record)
    terminal.onData(data => record.push(data))

    return terminal
  }

  const {runCode, Session} = require('../packages/tinkr-core/src/session')
  const {RunResultFilter, wrapRun, typedRun} = require('../packages/tinkr-core/src/runResult')
  const connection = {id: 'probe', path: app}

  const typing = async () => {
    section('typed into cmd /V:ON')

    const typed = ptyModule.spawn(process.env.ComSpec, ['/V:ON'], {
      cols: 2000,
      rows: 60,
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

    for (const [name, encode] of Object.entries({caretPlain, caretDelay})) {
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

  const first = async () => {
    section('the first run of a job')

    const started = Date.now()
    const answer = await runCode(connection, '1 + 1', {timeout: 20000}).then(
      result => ({result}),
      error => ({error}),
    )

    console.log(`first in ${Date.now() - started} ms ${show(JSON.stringify(
      answer.error ? {message: answer.error.message, output: answer.error.output} : answer.result,
    ), 400)}`)
    console.log(`first raw ${show((kept[kept.length - 1] || []).join(''), 3000)}`)
  }

  const boot = async () => {
    section('boot')

    const session = new Session(connection, {})

    session.start('php artisan tinker')

    if (!session.pty) {
      console.log('no pty')

      return null
    }

    const raw = []

    session.pty.onData(data => raw.push(data))

    const started = Date.now()
    const ready = await session.ready().then(() => 'ready', error => `failed: ${error.message}`)
    const text = raw.join('')

    console.log(`boot ${ready} in ${Date.now() - started} ms, ${text.length} bytes`)
    console.log(`boot-banner ${/Psy Shell v/.test(text)} boot-prompt ${/(?:^|[\r\n])(?:>>>|>|\.\.\.|\.) $/.test(text)}`)
    console.log(`boot-raw ${show(text, 2500)}`)

    return session
  }

  const big = async session => {
    if (!session) {
      return
    }

    section('2 MB echo')

    const run = wrapRun('echo str_repeat("x", 2000000); 7')
    const filter = new RunResultFilter(run.marker, run.start)
    let chunks = 0
    let largest = 0
    let total = 0
    let result = null

    session.pty.onData(data => {
      chunks++
      total += data.length
      largest = Math.max(largest, data.length)

      const pushed = filter.push(data)

      if (pushed.result) {
        result = pushed.result
      }
    })

    const typedAt = Date.now()

    session.type(typedRun(run.code)).catch(() => {})

    await new Promise(resolve => {
      const until = Date.now() + 60000

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

    console.log(`big in ${Date.now() - typedAt} ms: chunks ${chunks} largest ${largest} total ${total}`)
    console.log(`big filter: started ${filter.started} asked ${filter.asked} done ${filter.done}`)
    console.log(`big printed ${printed.length} early ${filter.early.length} value ${show(JSON.stringify(result && result.value))}`)
  }

  ;(async () => {
    console.log(`\n##### backend conpty=${useConpty}`)

    try {
      await typing()
      await first()

      const session = await boot()

      await big(session)

      if (session) {
        session.kill()
      }
    } catch (e) {
      console.log(`CHILD FAILED ${e.message}`)
    }

    console.log('\nchild done')
    process.exit(0)
  })()
}

if (process.argv[2] === 'child') {
  child(process.argv[3] === 'conpty')
} else {
  for (const backend of ['winpty', 'conpty']) {
    const result = spawnSync(process.execPath, [__filename, 'child', backend], {
      stdio: 'inherit',
      timeout: 240000,
    })

    console.log(`\n##### ${backend} child exited ${result.status} ${result.signal || ''} ${result.error ? result.error.message : ''}`)
  }

  console.log('\nprobe2 done')
}
