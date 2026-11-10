// Throwaway: one word at a time, typed into an interactive cmd /V:ON.
//
// The round trip of the whole word list was written as one line and the shell
// neither ran it nor said why. A line that cmd does not run is answered as a
// line at a time: every case here is its own line, closed by a marker printed
// after it, so the case that does not come back is the case that is named, and
// Ctrl+C puts the shell back at a prompt for the next one.
const fs = require('fs')
const path = require('path')

const pty = require('node-pty')

const {shellQuote} = require('../packages/tinkr-core/src/shell')

const app = process.env.APP
const argvScript = path.join(__dirname, 'argv.js')
const out = path.join(app, 'line-argv.json')
const node = process.execPath

const terminal = pty.spawn(process.env.ComSpec, ['/V:ON'], {
  cols: 2000, rows: 60, cwd: app, env: process.env,
})

let buffer = ''

terminal.onData(data => {
  buffer += data
})

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (text, ms) => {
  const until = Date.now() + ms

  while (Date.now() < until && !buffer.includes(text)) {
    await sleep(25)
  }

  return buffer.includes(text)
}

// a case is the word as the app would write it, and the same line for every
// one of them: node, the argv script, a file, the word, and a marker
const caseLine = (encoded, mark) =>
  `${shellQuote(node, 'win32', {delayed: true})} ${shellQuote(argvScript, 'win32', {delayed: true})} --out ${shellQuote(out, 'win32', {delayed: true})} ${encoded} & echo ${mark}`

const cases = [
  ['plain', shellQuote('plain', 'win32', {delayed: true})],
  ['with space', shellQuote('with space', 'win32', {delayed: true})],
  ['quote"inside', shellQuote('quote"inside', 'win32', {delayed: true})],
  ["single'q", shellQuote("single'q", 'win32', {delayed: true})],
  ['%PATH%', shellQuote('%PATH%', 'win32', {delayed: true})],
  ['!bang!', shellQuote('!bang!', 'win32', {delayed: true})],
  ['a&b|c<d>e(f)', shellQuote('a&b|c<d>e(f)', 'win32', {delayed: true})],
  ['trail\\', shellQuote('trail\\', 'win32', {delayed: true})],
  ['comma,semi;eq=', shellQuote('comma,semi;eq=', 'win32', {delayed: true})],
  ['ünïcødé', shellQuote('ünïcødé', 'win32', {delayed: true})],
  ['empty', shellQuote('', 'win32', {delayed: true})],
  ['caret one', '^"caret^x^"'],
  ['caret two', '^"caret^^x^"'],
  ['caret four', '^"caret^^^^x^"'],
  ['caret eight', '^"caret^^^^^^^^x^"'],
]

;(async () => {
  await waitFor('>', 20000)

  for (const [index, [name, encoded]] of cases.entries()) {
    const mark = `~~DONE${index}~~`
    const at = buffer.length

    try {
      fs.unlinkSync(out)
    } catch (error) {
    }

    terminal.write(`${caseLine(encoded, mark)}\r`)

    const ended = await waitFor(mark, 8000)
    let got = null

    try {
      got = fs.readFileSync(out, 'utf8')
    } catch (error) {
      got = null
    }

    const raw = buffer.slice(at)

    console.log(`CASE ${name} :: ${JSON.stringify({ended, got, encoded, raw: raw.slice(-700)})}`)

    if (!ended) {
      // a line cmd did not run leaves it reading the line still: the interrupt
      // is what puts it back at a prompt for the case after this one
      terminal.write('\u0003')
      await sleep(500)
      buffer = ''
    }
  }

  terminal.kill()
  process.exit(0)
})()
