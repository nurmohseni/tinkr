// Throwaway: what a program receives, as one line of JSON. With `--out <file>`
// it is written to that file instead, so a line longer than the terminal is wide
// is read as the JSON and not as the console's wrapping of it.
const fs = require('fs')

const args = process.argv.slice(2)
const at = args.indexOf('--out')
const out = at === -1 ? null : args[at + 1]
const got = at === -1 ? args : args.slice(0, at).concat(args.slice(at + 2))
const text = JSON.stringify(got)

if (out) {
  fs.writeFileSync(out, text)
} else {
  process.stdout.write(`${text}\n`)
}
