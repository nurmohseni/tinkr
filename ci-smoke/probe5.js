// Throwaway: what a `/V:ON` shell does with a caret, a bang and a percent.
//
// Run B typed the smoke's words into a `/V:ON` cmd with one caret before every
// metacharacter and `^^!` before a bang. Every word came back as itself but
// `caret^x`, which came back as `caretx`: the caret that was meant for the
// program never reached it. A shell with delayed expansion reads carets twice —
// once in the parse, once while it looks for a bare `!` — so a caret that must
// survive needs one escape for each reading, and a bang one for each as well.
//
// This prints the verdict of three encodings over the same words, so which one
// the shell reads as written is answered by what came back and not by reasoning
// about the two phases:
//
// - `one caret`, one escape before every metacharacter, `^^` before a bang
// - `a caret four times`, the same, and a caret that is part of the word written
//   as four carets instead of two
// - `two carets everywhere`, the whole escape applied twice, quotes included
const fs = require('fs')
const path = require('path')
const pty = require('node-pty')

const {shellQuote} = require('../packages/tinkr-core/src/shell')

const app = process.env.APP
const argvScript = path.join(__dirname, 'argv.js')
const show = value => JSON.stringify(String(value).slice(0, 600))

// the escape one caret at a time, written here so the probe does not have to wait
// for a product change to read the answer
const crt = value => {
  let out = '"'
  let slashes = 0

  for (const char of String(value)) {
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

const metacharacter = /([()%^"`<>&|;, *?[\]])/g
const once = value => crt(value).replace(metacharacter, '^$&').replace(/!/g, '^^!')
const caretFour = value => crt(value).replace(metacharacter, char => (char === '^' ? '^^^^' : `^${char}`)).replace(/!/g, '^^!')
const twice = value => once(value).replace(/\^/g, '^^')

const words = ['plain', 'with space', 'quote"inside', "single'q", '%PATH%', '!bang!', 'a&b|c<d>e(f)', 'caret^x', 'two^^carets', 'x^', '^x', 'ünïcødé', 'trail\\', 'comma,semi;eq=', '']

const typed = async (name, encode) => {
  const out = path.join(app, `typed-${name.replace(/[^a-z]+/gi, '-')}.json`)

  try { fs.unlinkSync(out) } catch (e) {}

  const terminal = pty.spawn(process.env.ComSpec, ['/V:ON'], {cols: 2000, rows: 60, cwd: app, env: process.env})
  let buffer = ''

  terminal.onData(data => { buffer += data })

  const end = '~~PROBE5~~'
  const written = `${shellQuote(process.execPath, 'win32', {delayed: true})} ${shellQuote(argvScript, 'win32', {delayed: true})} --out ${shellQuote(out, 'win32', {delayed: true})} ${words.map(encode).join(' ')}`

  terminal.write(`${written} & echo ${end}\r`)

  const until = Date.now() + 30000

  while (Date.now() < until && !buffer.includes(end)) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  let got = null
  try { got = JSON.parse(fs.readFileSync(out, 'utf8')) } catch (e) {}

  const differs = Array.isArray(got)
    ? words.map((word, at) => (got[at] === word ? null : [word, got[at]])).filter(Boolean)
    : [[null, got]]

  console.log(`${name}\n  line ${show(written)}\n  argv ${show(JSON.stringify(got))}\n  differs ${show(JSON.stringify(differs))}\n  screen ${show(buffer.slice(-300))}`)

  terminal.kill()
}

const run = async () => {
  for (const [name, encode] of [['one caret', once], ['a caret four times', caretFour], ['two carets everywhere', twice]]) {
    await typed(name, encode)
  }
}

run().then(() => process.exit(0), error => {
  console.log(`probe5 threw: ${error && error.message}`)
  process.exit(1)
})
