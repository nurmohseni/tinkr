// Throwaway: where the caret escapes stop working, and what a `/V:ON` shell does
// with a bang and a percent.
//
// probe3 ran six words through `cmd /d /s /c "<line>"` and every one of them came
// back as itself. The smoke ran twelve and `%PATH%` and `!bang!` kept their carets.
// So this prints the same verdict for the smoke's own line and for the line with
// one word taken out at a time: the shape that stops escaping says what the rule
// is, and guessing at it has been wrong twice.
//
// The second half types into a `/V:ON` cmd and reads its answer from a file, so a
// line the console wraps is not read as a wrapped line. It prints before it kills
// the terminal: a conpty's console list agent throws on some kills, and a probe
// that dies there says nothing.
const {spawnSync} = require('child_process')
const fs = require('fs')
const path = require('path')
const pty = require('node-pty')

const {shellQuote} = require('../packages/tinkr-core/src/shell')

const app = process.env.APP
const argvScript = path.join(__dirname, 'argv.js')
const q = (value, options) => shellQuote(value, 'win32', options)
const show = value => JSON.stringify(String(value).slice(0, 600))

// the smoke's words, as they were when it failed
const words = ['plain', 'with space', 'quote"inside', "single'q", '%PATH%', '!bang!', 'a&b|c<d>e(f)', 'caret^x', 'ünïcødé', 'trail\\', 'comma,semi;eq=', '']
const code = 'console.log(JSON.stringify(process.argv.slice(1)))'

const throughC = (name, line, expected) => {
  const result = spawnSync(process.env.ComSpec, ['/d', '/s', '/c', `"${line}"`], {
    windowsVerbatimArguments: true,
    cwd: app,
    encoding: 'utf8',
    timeout: 30000,
  })
  const text = String(result.stdout || '').trim().split(/\r?\n/).pop()
  let got = null
  try { got = JSON.parse(text) } catch (e) {}
  const kept = Array.isArray(got) && Array.isArray(expected)
    ? got.filter((word, at) => word !== expected[at]).map((word, at) => [expected[at], word])
    : []
  console.log(`${name}\n  line ${show(line)}\n  argv ${show(text)}\n  differs ${show(kept)}\n  err  ${show(result.stderr)}`)
}

const line = list => `node -e ${q(code)} ${list.map(word => q(word)).join(' ')}`

const run = async () => {
  console.log(`node ${process.execPath} argv ${argvScript}`)

  throughC('the smoke\'s line', line(words), words)
  throughC('without %PATH%', line(words.filter(word => word !== '%PATH%')), words.filter(word => word !== '%PATH%'))
  throughC('without !bang!', line(words.filter(word => word !== '!bang!')), words.filter(word => word !== '!bang!'))
  throughC('without quote"inside', line(words.filter(word => word !== 'quote"inside')), words.filter(word => word !== 'quote"inside'))
  throughC('without single\'q', line(words.filter(word => word !== "single'q")), words.filter(word => word !== "single'q"))
  throughC('without trail\\', line(words.filter(word => word !== 'trail\\')), words.filter(word => word !== 'trail\\'))
  throughC('%PATH% first', line(['%PATH%'].concat(words.filter(word => word !== '%PATH%'))), ['%PATH%'].concat(words.filter(word => word !== '%PATH%')))
  throughC('the code word as plain quotes', `node -e "${code.replace(/"/g, '\\"')}" ${words.map(word => q(word)).join(' ')}`, words)
  throughC('six words, as probe3', `node ${q(argvScript)} ${['%PATH%', '!bang!', 'caret^x', 'a&b|c<d>e(f)', 'with space', ''].map(word => q(word)).join(' ')}`, ['%PATH%', '!bang!', 'caret^x', 'a&b|c<d>e(f)', 'with space', ''])

  // --- typed into a /V:ON shell ---------------------------------------------

  const out = path.join(app, 'typed.json')
  const typed = [['one caret before each', word => q(word, {delayed: false})], ['two before a bang', word => q(word, {delayed: true})]]
  const answers = ['%PATH%', '!bang!', '100%', 'C:\\100%\\bin']

  for (const [name, encode] of typed) {
    try { fs.unlinkSync(out) } catch (e) {}

    const terminal = pty.spawn(process.env.ComSpec, ['/V:ON'], {cols: 2000, rows: 60, cwd: app, env: process.env})
    let buffer = ''

    terminal.onData(data => { buffer += data })

    const end = '~~PROBE4~~'
    const written = `${q(process.execPath, {delayed: true})} ${q(argvScript, {delayed: true})} --out ${q(out, {delayed: true})} ${answers.map(encode).join(' ')}`

    terminal.write(`${written} & echo ${end}\r`)

    const until = Date.now() + 30000

    while (Date.now() < until && !buffer.includes(end) && !fs.existsSync(out)) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    let got = null
    try { got = fs.readFileSync(out, 'utf8') } catch (e) {}

    console.log(`typed, ${name}\n  line ${show(written)}\n  argv ${show(got)}\n  screen ${show(buffer.slice(-400))}`)
    terminal.kill()
  }
}

run().then(() => process.exit(0), error => {
  console.log(`probe4 threw: ${error && error.message}`)
  process.exit(1)
})
