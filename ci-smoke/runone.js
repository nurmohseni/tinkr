// Throwaway: one run, in a process of its own, with what the terminal wrote kept.
//
// A run that answers nothing leaves the same three questions every time — was the
// command ever typed, did psysh read it, did the answer come back and got lost —
// and the only way to tell them apart is the raw stream. The run is also alone in
// its process so a terminal that a previous run left behind cannot be what this
// one is measured against.
//
// Every step of a run is also put on a timeline: the write that started the
// shell, the boot, the wait for the command to read, every line typed into it,
// every chunk that came back, and the answer. A run that takes twenty seconds
// says in that timeline which of its waits took them.
const fs = require('fs')
const ptyModule = require('node-pty')

const kept = []
const original = ptyModule.spawn

const started = Date.now()
const timeline = []
const trace = (event, detail = '') => timeline.push([Date.now() - started, event, String(detail).slice(0, 400)])
// what a chunk says, with its control characters written out and its length in
// whole: a chunk of 2 MB is read by its head and its tail
const visible = data => {
  const text = String(data)
  const shown = text.length > 160 ? `${text.slice(0, 80)}\\u2026${text.slice(-80)}` : text

  return JSON.stringify(shown).slice(0, 700)
}

ptyModule.spawn = (shell, args, options) => {
  trace('pty spawn', `${shell} ${JSON.stringify(args)} cols=${options && options.cols} rows=${options && options.rows} cwd=${options && options.cwd}`)
  const terminal = original(shell, args, options)

  const index = kept.length
  kept.push([])
  const write = terminal.write.bind(terminal)

  terminal.write = data => {
    trace('write', `len=${String(data).length} ${visible(data)}`)

    return write(data)
  }

  terminal.onData(data => {
    kept[index].push(data)
    trace('data', `len=${String(data).length} ${visible(data)}`)
  })

  return terminal
}

const {Session, runCode} = require('../packages/tinkr-core/src/session')

for (const name of ['ready', 'type']) {
  const real = Session.prototype[name]

  Session.prototype[name] = function (...args) {
    const at = Date.now()
    trace(name, `begin${name === 'type' ? ` lines=${args[0].length} lens=${args[0].map(line => line.length).join(',')}` : ''}`)

    return real.apply(this, args).then(
      value => {
        trace(name, `ok ${Date.now() - at}ms`)

        return value
      },
      error => {
        trace(name, `fail ${Date.now() - at}ms ${error.message}`)

        throw error
      },
    )
  }
}

const code = process.argv[2]
const timeout = Number(process.env.RUN_TIMEOUT || 30000)

// the head says whether the command ever booted, and the tail is where a lost
// answer shows: the prompt that came back without it
const raw = () => {
  const text = kept.map(record => record.join('')).join('')

  return text.length <= 6000 ? text : `${text.slice(0, 1500)}\n~~~\n${text.slice(-4000)}`
}

const writeTimeline = () => {
  if (!process.env.TRACE) {
    return
  }

  try {
    fs.writeFileSync(process.env.TRACE, JSON.stringify(timeline))
  } catch (e) {
  }
}

const done = (status, answer) => {
  trace('done', status)
  writeTimeline()

  const line = `${status} ${JSON.stringify(Object.assign({ms: Date.now() - started}, answer, {raw: raw()}))}\n`

  // a pipe on Windows drops what is still buffered if the process exits at once
  process.stdout.write(line, () => process.exit(status === 'RESULT' ? 0 : 1))
}

runCode({id: 'runone', path: process.env.APP, command: 'php artisan tinker'}, code, {timeout}).then(
  result => done('RESULT', {
    value: result.value,
    error: result.error || null,
    output: String(result.output || '').slice(0, 400),
    len: String(result.output || '').length,
  }),
  error => done('ERROR', {message: error.message, output: String(error.output || '').slice(0, 400), len: String(error.output || '').length}),
)
