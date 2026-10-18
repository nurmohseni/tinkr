#!/usr/bin/env node
const {createServer} = require('./server')
const {serve} = require('./protocol')
const target = require('./target')
const {name, version} = require('../package.json')

/**
 * The MCP server an AI tool starts.
 *
 * It is started the way any other MCP server is — the client runs this file and
 * talks to it over stdin and stdout — and where it runs code is decided here:
 * the connection named with `--connection`, the app's connection for the
 * directory it was started in, or that directory itself.
 */
const usage = `tinkr-mcp ${version} — run PHP in a project, for an MCP client

Usage: tinkr-mcp [options]

Options:
  --connection <id|name>  a connection saved in Tinkr to run code in
  --path <directory>      the project to run in (default: where it is started)
  --command <command>     what the session is started with (default: the
                          connection's own, or Tinkr's preference,
                          "php artisan tinker")
  --data-dir <directory>  where Tinkr keeps its own files, when it is not where
                          the app looks for them
  --timeout <ms>          how long a run may take before it is given up on
                          (default: 60000)
  --allow-production      run code on connections tagged production. Without it
                          a production connection is refused unless this server
                          was started on that one connection
  -h, --help              this
  -v, --version           the version
`

/**
 * @param{Array<String>} argv
 * @return {Object}
 */
const parseArguments = argv => {
  const options = {}
  const values = {
    '--connection': 'connection',
    '--path': 'at',
    '--command': 'command',
    '--data-dir': 'dataDir',
  }

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]

    if (values[argument]) {
      const value = argv[++index]

      if (value === undefined) {
        throw new Error(`${argument} needs a value`)
      }

      options[values[argument]] = value

      continue
    }

    if (argument === '--timeout') {
      const value = Number(argv[++index])

      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--timeout needs a number of milliseconds')
      }

      options.timeout = value

      continue
    }

    if (argument === '--allow-production') {
      options.allowProduction = true

      continue
    }

    if (argument === '--help' || argument === '-h') {
      options.help = true

      continue
    }

    if (argument === '--version' || argument === '-v') {
      options.showVersion = true

      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return options
}

const main = () => {
  let options

  try {
    options = parseArguments(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`tinkr-mcp: ${e.message}\n\n${usage}`)
    process.exitCode = 1

    return
  }

  if (options.help) {
    process.stdout.write(usage)

    return
  }

  if (options.showVersion) {
    process.stdout.write(`${version}\n`)

    return
  }

  let resolved

  try {
    resolved = target.resolve(options)
  } catch (e) {
    process.stderr.write(`tinkr-mcp: ${e.message}\n`)
    process.exitCode = 1

    return
  }

  const server = createServer({
    target: resolved,
    version,
    timeout: options.timeout || 60000,
    allowProduction: Boolean(options.allowProduction),
    // a server started on one connection by name is pinned to it: that is the
    // choice someone made for this server, and it is what lets a production
    // connection through without the flag
    pinned: Boolean(options.connection),
    command: options.command || null,
  })

  // the client's stderr is the log: what the server is running in is the first
  // thing to look at when a call comes back wrong
  process.stderr.write(
    `tinkr-mcp ${version}: ${resolved.connection.is_over_ssh ? 'over ssh as' : 'in'} ` +
    `${resolved.connection.is_over_ssh ? resolved.connection.ssh_server : resolved.connection.path}` +
    `${resolved.saved ? ` (${resolved.connection.name})` : ''}\n`,
  )

  const connection = serve({server, name, version, onEnd: () => process.exit(0)})

  process.on('SIGTERM', () => {
    connection.stop()
    process.exit(0)
  })
}

if (require.main === module) {
  main()
}

module.exports = {
  parseArguments,
  usage,
  main,
}
