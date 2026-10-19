const fs = require('fs')
const path = require('path')

/**
 * A connection that logs in with a password, without the password travelling
 * anywhere that can be read.
 *
 * ssh reads a password from the terminal it was started on, and this app's
 * terminal is a pty the window shows: what is typed there is on screen, and what
 * is written into it is echoed before ssh turns the echo off. So the password is
 * not typed at all. ssh is told to take it from a helper instead — `SSH_ASKPASS`
 * — and the helper answers with the password the connection saved.
 *
 * Each piece is load-bearing, and each was checked against a real password-only
 * sshd:
 *
 * - **`SSH_ASKPASS_REQUIRE=force`.** ssh asks a helper only when it has no
 *   terminal, and a session always has one. `force` is what says "ask anyway".
 * - **The helper is a script, run by a binary.** ssh runs the helper with the
 *   prompt as its one argument. On posix that is a `sh` shim, because ssh
 *   spawns the file itself. On windows it cannot be a script at all: ssh there
 *   spawns the helper with `CreateProcess`, which runs neither a `.bat` nor a
 *   `.cmd`, so what ssh is pointed at is the binary the app already runs —
 *   electron in the packaged app, node for the MCP server — with the helper
 *   loaded into it before its own start by `NODE_OPTIONS`.
 * - **The password is in a file the helper reads, not in an argument or the
 *   environment.** A process's arguments are readable by anything on the machine
 *   (`ps`) and a pty echoes them, and its environment is readable by `ps e`. The
 *   secret lives in a 0600 file in the app's own data directory, which is
 *   readable by its owner — the same person ssh already runs as.
 * - **The helper answers only this connection's own prompt.** The session's
 *   shell inherits the environment, so someone who types `ssh other-server` in
 *   the app's terminal must not be handed this connection's password. ssh's
 *   password prompt names the account (`root@db.example.com's password:`), so
 *   the helper answers a prompt that names this connection's user and server.
 * - **The helper leaves a process alone when it is not a prompt.** On windows the
 *   preload runs for any node started in that shell; a script path is not a
 *   prompt, so the helper returns before it reads or writes anything.
 */

/**
 * The helper ssh runs for a password.
 *
 * It is a node script loaded into the app's own binary for every prompt, so it
 * is plain: no imports beyond `fs`, nothing that can throw past its own `try`,
 * and a status of 0 whatever it decided — ssh reads a non-zero status as "the
 * helper failed", which ends the login instead of answering it.
 *
 * What is not this connection's password is left unread rather than guessed at:
 * a key's passphrase and a second factor are asked through the same call, and
 * sending either of them the account's password puts it somewhere it does not
 * belong.
 *
 * `fs.writeSync` rather than `process.stdout.write`: the answer goes into a pipe,
 * and a write still buffered when the process exits would be a password that
 * never arrived.
 */
const helperSource = `'use strict'

var fs = require('fs')

// the prompt is the last argument either way: \`<binary> <script> <prompt>\` when
// a shim runs the script, \`<binary> <prompt>\` when the script is preloaded
var prompt = String(process.argv[process.argv.length - 1] || '')
var who = String(process.env.TINKR_SSH_SECRET_WHO || '')

var elsewhere = /passphrase|verification|one-time|token/i
var namesThisAccount = Boolean(who) && prompt.indexOf(who) !== -1
var askingToConnect = /yes\\/no|type 'yes'/i.test(prompt)
var askingForPassword = /password/i.test(prompt) && !elsewhere.test(prompt) && namesThisAccount

// not a prompt of ssh's: this process is whatever the person is running, and it
// goes on exactly as it would have
if (!askingToConnect && !askingForPassword) {
  return
}

var answer = askingForPassword ? '' : 'no'

if (askingForPassword) {
  try {
    var file = process.env.TINKR_SSH_SECRET_FILE
    var id = process.env.TINKR_SSH_SECRET_ID
    var stored = JSON.parse(fs.readFileSync(file, 'utf8'))

    answer = String((stored && stored[id]) || '')
  } catch (e) {
    // no secret to read is an empty password, which ssh refuses the way it
    // refuses any other wrong one: the login fails, the helper does not crash
    answer = ''
  }
}

try {
  fs.writeSync(1, answer + '\\n')
} catch (e) {
  // a pipe that closed is a login that ended: nothing to answer, nothing to do
}

process.exit(0)
`

/**
 * Where a connection's secrets are kept.
 *
 * It is the app's own data directory, beside the connections and the preferences,
 * and it is read by the app and by the MCP server's separate process alike (see
 * tinkr-mcp's app.js): one file, so the password saved in the window is the
 * password a run from an agent uses.
 *
 * @param {String} dir the app's data directory
 * @return {String}
 */
const secretsFile = dir => path.join(dir, 'app', 'secrets.json')

/**
 * Where the helper is written, inside the app's data directory.
 *
 * @param {String} dir
 * @return {String}
 */
const helperFile = dir => path.join(dir, 'ssh', 'askpass.js')

/**
 * Where the posix shim that runs the helper is written.
 *
 * @param {String} dir
 * @return {String}
 */
const shimFile = dir => path.join(dir, 'ssh', 'askpass.sh')

/**
 * Whether a connection logs in with a saved password.
 *
 * A connection keeps a flag, never the password: the connections store is a file
 * the whole of which is handed to the window, so a password in it would be a
 * password in the renderer's memory, in every clone of the connection, and in
 * anything that dumps that file. The secret is kept beside it, in its own file,
 * and the flag says only that one is there.
 *
 * @param {Object} connection
 * @return {Boolean}
 */
const usesPassword = connection => Boolean(connection && connection.is_over_ssh && connection.ssh_password)

/**
 * What ssh is told about a password login, as arguments of the command.
 *
 * `accept-new` is what a first connection to a server needs: the helper answers
 * the prompts, so there is nobody left to answer "are you sure?" — and it is the
 * same trust-on-first-use a terminal already asks for. A key that *changed* is
 * still refused, which is the part of that check that matters.
 *
 * `NumberOfPasswordPrompts=1` makes a wrong password a failure rather than three
 * more prompts, each one another helper start.
 *
 * Both are only in the line of a connection that has a password: one with a key
 * is reached the way it always was.
 *
 * @param {Object} connection
 * @return {Array<String>}
 */
const passwordArgs = connection => (usesPassword(connection)
  ? ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'NumberOfPasswordPrompts=1']
  : [])

/**
 * A value as one word of a shell reads it.
 *
 * @param {String} value
 * @return {String}
 */
const word = value => `'${String(value).replace(/'/g, "'\\''")}'`

/**
 * Write a file only its owner can read.
 *
 * @param {String} file
 * @param {String} contents
 * @param {Number} mode
 */
const writePrivate = (file, contents, mode) => {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700})
  fs.writeFileSync(file, contents, {mode})

  try {
    fs.chmodSync(file, mode)
    fs.chmodSync(path.dirname(file), 0o700)
  } catch (e) {
    // windows sets no mode, and a user's own profile directory is already
    // readable only by them
  }
}

/**
 * Write the helper, and answer with what ssh has to be pointed at.
 *
 * It is written once and read on every prompt, so a file that already holds it
 * is left alone. The directory is 0700 and the files 0600/0700: the helper is
 * not a secret itself, but a process that could replace it could print anything
 * a password prompt asks for.
 *
 * @param {String} dir the app's data directory
 * @return {{askpass: String, script: String, preload: String|null}|null} null
 *   when it cannot be written, which is a connection reached the old way, with
 *   ssh asking the terminal
 */
const writeHelper = dir => {
  try {
    const script = helperFile(dir)

    if (!fs.existsSync(script) || fs.readFileSync(script, 'utf8') !== helperSource) {
      writePrivate(script, helperSource, 0o600)
    }

    if (process.platform === 'win32') {
      // ssh spawns the helper with CreateProcess, which runs an executable and
      // not a script: the executable is the app's own, and the script is put in
      // front of it by NODE_OPTIONS
      return {
        askpass: process.execPath,
        script,
        preload: `--require=${JSON.stringify(script)}`,
      }
    }

    // posix: a shim ssh can spawn, which runs the script with the app's binary.
    // ELECTRON_RUN_AS_NODE makes that binary a node, which is what it already is
    // for the MCP server
    const shim = shimFile(dir)
    const source = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${word(process.execPath)} ${word(script)} "$@"\n`

    if (!fs.existsSync(shim) || fs.readFileSync(shim, 'utf8') !== source) {
      writePrivate(shim, source, 0o700)
    }

    return {askpass: shim, script, preload: null}
  } catch (e) {
    return null
  }
}

/**
 * What a session over ssh needs to be answered when the connection has a
 * password, or null when it has none.
 *
 * Two halves, because the two places they have to be are not the same place:
 *
 * - `env` goes into the pty's environment, which is where the helper itself is
 *   chosen (`SSH_ASKPASS`) and where it finds the secret.
 * - `line` goes on the command line ssh is started with, and it is the same
 *   variable names over again. The shell in front of ssh is a *login* shell, so
 *   a profile that sets `SSH_ASKPASS` — a desktop's own askpass helper is one,
 *   and it opens a window no session can answer — runs after the environment was
 *   handed over and replaces what was in it. An assignment written on the line
 *   is read after the profile has run, which is what makes the helper ours.
 *
 * Neither half carries the password: the program that answers, the file the
 * secret is in, the connection whose entry to read, and the account a prompt has
 * to name. The helper reads the password itself, which is what keeps it out of
 * the command line, out of the environment, and off the terminal.
 *
 * @param {String} dir the app's data directory
 * @param {Object} connection
 * @return {{env: Object, line: Object}|null}
 */
const askpassEnvironment = (dir, connection) => {
  // the connection's own id is how its password is found: a connection that has
  // one saved and no id is one whose secret cannot be looked up, and handing the
  // helper the word `undefined` would be a lookup for a connection that is not
  // any
  if (!dir || !usesPassword(connection) || connection.id === undefined) {
    return null
  }

  const helper = writeHelper(dir)

  if (!helper) {
    return null
  }

  const values = {
    SSH_ASKPASS: helper.askpass,
    SSH_ASKPASS_REQUIRE: 'force',
    TINKR_SSH_SECRET_FILE: secretsFile(dir),
    TINKR_SSH_SECRET_ID: String(connection.id),
    TINKR_SSH_SECRET_WHO: `${connection.ssh_user}@${connection.ssh_server}`,
  }

  const env = Object.assign({}, values)

  if (helper.preload) {
    const existing = process.env.NODE_OPTIONS

    env.ELECTRON_RUN_AS_NODE = '1'
    env.NODE_OPTIONS = existing ? `${existing} ${helper.preload}` : helper.preload
  }

  // what can be written on a line is what a shell can be handed, so the line
  // keeps the variables and leaves the node preload to the environment
  const line = Object.assign({}, values)

  if (helper.preload) {
    line.NODE_OPTIONS = helper.preload
    line.ELECTRON_RUN_AS_NODE = '1'
  }

  return {env, line}
}

module.exports = {
  helperSource,
  secretsFile,
  helperFile,
  shimFile,
  writeHelper,
  usesPassword,
  passwordArgs,
  askpassEnvironment,
}
