// Throwaway: one run, in a process of its own, with what the terminal wrote kept.
//
// A run that answers nothing leaves the same three questions every time — was the
// command ever typed, did psysh read it, did the answer come back and got lost —
// and the only way to tell them apart is the raw stream. The run is also alone in
// its process so a terminal that a previous run left behind cannot be what this
// one is measured against.
const ptyModule = require('node-pty')

const kept = []
const original = ptyModule.spawn

ptyModule.spawn = (shell, args, options) => {
  const terminal = original(shell, args, options)

  kept.push([])
  terminal.onData(data => kept[kept.length - 1].push(data))

  return terminal
}

const {runCode} = require('../packages/tinkr-core/src/session')

const code = process.argv[2]
const timeout = Number(process.env.RUN_TIMEOUT || 30000)
const started = Date.now()

// the tail is where a lost answer shows: the prompt that came back without it
const raw = () => kept.map(record => record.join('')).join('').slice(-5000)

const done = (status, answer) => {
  const line = `${status} ${JSON.stringify(Object.assign({ms: Date.now() - started}, answer, {raw: raw()}))}\n`

  // a pipe on Windows drops what is still buffered if the process exits at once
  process.stdout.write(line, () => process.exit(status === 'RESULT' ? 0 : 1))
}

runCode({id: 'runone', path: process.env.APP, command: 'php artisan tinker'}, code, {timeout}).then(
  result => done('RESULT', {value: result.value, output: String(result.output || '').slice(0, 400), len: String(result.output || '').length}),
  error => done('ERROR', {message: error.message, output: String(error.output || '').slice(0, 400), len: String(error.output || '').length}),
)
