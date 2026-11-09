// Throwaway: what a program receives, as one line of JSON.
process.stdout.write(`${JSON.stringify(process.argv.slice(2))}\n`)
