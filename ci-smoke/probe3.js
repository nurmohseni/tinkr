// Throwaway: which shape of a `/c` line keeps a caret escape working.
//
// probe.js showed the caret rule round-tripping 26 words through
// `cmd /d /s /c "<line>"` when the line was `"node.exe" "argv.js" <words>`, and
// the smoke then showed `%PATH%` and `!bang!` keeping their caret in a line that
// began `node -e ^"…"`. The two differ only in the words before the ones that
// failed, so this prints, for every shape, the exact line and the argv it
// produced.
const {spawnSync} = require('child_process')
const path = require('path')
const pty = require('node-pty')

const {shellQuote} = require('../packages/tinkr-core/src/shell')

const app = process.env.APP
const nodeExe = process.execPath
const argvScript = path.join(__dirname, 'argv.js')
const q = value => shellQuote(value, 'win32')
const show = value => JSON.stringify(String(value).slice(0, 400))

const words = ['%PATH%', '!bang!', 'caret^x', 'a&b|c<d>e(f)', 'with space', '']
const code = 'console.log(JSON.stringify(process.argv.slice(1)))'

// a line as the shell reads it: cmd /d /s /c "<line>"
const throughC = async (name, line) => {
  const result = spawnSync(process.env.ComSpec, ['/d', '/s', '/c', `"${line}"`], {
    windowsVerbatimArguments: true,
    cwd: app,
    encoding: 'utf8',
    timeout: 30000,
  })
  const text = String(result.stdout || '').trim().split(/\r?\n/).pop()

  console.log(`${name}\n  line ${show(line)}\n  argv ${show(text)}\n  err  ${show(result.stderr)}`)
}

const run = async () => {
  console.log(`node ${nodeExe} argv ${argvScript}`)

  // the control: what probe.js proved
  await throughC('control: program and script as plain quotes',
    `"${nodeExe}" "${argvScript}" ${words.map(q).join(' ')}`)

  // the smoke's shape: an `-e` word before the words
  await throughC('with an -e word',
    `node -e ${q(code)} ${q(argvScript)} ${words.map(q).join(' ')}`)

  // the same, but the program word is not quoted at all
  await throughC('bare program word',
    `node ${q(argvScript)} ${words.map(q).join(' ')}`)

  // the same, without the `-e` word, to tell the two apart
  await throughC('one word only', `node ${q(argvScript)} ${q('%PATH%')}`)

  // what `!` does with one caret and with two, under `/c` (no delayed expansion)
  await throughC('one caret before a bang', `node ${q(argvScript)} ^"^!bang^!^"`)
  await throughC('two carets before a bang', `node ${q(argvScript)} ^"^^!bang^^!^"`)

  // what `%` does with a caret, and with the doubled form a batch file uses
  await throughC('one caret before a percent', `node ${q(argvScript)} ^"^%PATH^%^"`)
  await throughC('two carets before a percent', `node ${q(argvScript)} ^"^^%PATH^^%^"`)
  await throughC('a percent doubled', `node ${q(argvScript)} ^"%%PATH%%^"`)
  await throughC('a percent alone', `node ${q(argvScript)} ^"%^"`)
  await throughC('a percent alone, doubled', `node ${q(argvScript)} ^"%%^"`)

  // the code word quoted the crt way rather than the caret way, with the words
  // after it caret-escaped
  await throughC('crt code word, caret words',
    `node -e ${`"${code.replace(/"/g, '\\"')}"`} ${q(argvScript)} ${words.map(q).join(' ')}`)

  // a terminal 2000 columns wide, which is what the caret matrix was typed into
  // and did not answer from: does cmd print at all there?
  for (const cols of [500, 2000]) {
    const typed = pty.spawn(process.env.ComSpec, ['/V:ON'], {cols, rows: 40, cwd: app, env: process.env})
    let buffer = ''

    typed.onData(data => {
      buffer += data
    })

    const end = `~~END${cols}~~`

    typed.write(`node ${q(argvScript)} ${q('%PATH%')} ${q('!bang!')} & echo ${end}\r`)

    const until = Date.now() + 20000

    while (Date.now() < until && !buffer.includes(end)) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    typed.kill()
    console.log(`typed at ${cols} columns: ${show(buffer)}`)
  }
}

run()
