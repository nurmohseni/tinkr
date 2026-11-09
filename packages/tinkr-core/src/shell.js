/**
 * A value as one word of the shell that will read it.
 *
 * Every command this app runs is built as a string, because a session is a line
 * typed into a pty and an ssh command is a line the far shell re-parses. A
 * connection's fields are what a person typed — a path with a space in it, a
 * quote, a `;` — and a string that is not quoted is a string the shell takes
 * apart: `127.0.0.1; touch /tmp/x` runs the touch, and a directory called
 * `my app` becomes two words and a failure that says nothing about the real one.
 *
 * There is no one quoting for both platforms. A posix shell reads a word between
 * single quotes as it is, and has one way to write a single quote inside one. cmd
 * does not know single quotes at all — it treats them as ordinary characters, so
 * `'ssh'` is a program whose name has an apostrophe in it — and it has its own
 * expansion phases, which is why the two rules live here side by side rather than
 * being one rule with a special case.
 *
 * `platform` is a parameter and not `process.platform` read where it is needed,
 * because none of this can be exercised on the platform that is not running: a
 * test has to be able to say `'win32'` on a linux machine, and it has to be able
 * to say `'posix'` on a windows one. Callers that build a string for their own
 * machine leave it out; callers that build one for another machine — an ssh
 * line, a command inside a container — pass the platform of the side that will
 * read it.
 *
 * @typedef {'win32'|'posix'|String} Platform a node platform name; anything that
 *   is not `win32` is a posix shell
 */

/**
 * Whether a platform name is the one whose shell is cmd.exe.
 *
 * cmd.exe is the target, and not PowerShell: the session's shell is what
 * `default-shell` answers, which is `COMSPEC`, and a person who has set COMSPEC
 * to PowerShell has a session this quoting does not describe. That is a
 * documented assumption rather than a half-supported second syntax.
 *
 * @param {Platform} [platform]
 * @return {Boolean}
 */
const isWindows = platform => (platform || process.platform) === 'win32'

/**
 * A value as one word of a posix shell.
 *
 * Single quotes are the only quoting a posix shell does not interpret anything
 * inside of — not `$`, not a backtick, not a backslash — so a word is wrapped in
 * them. The one character they cannot hold is a single quote itself, which ends
 * the quoted run: it is written as `'\''`, which is a close, an escaped quote,
 * and a reopen, and the three between them are one quote in the argv the program
 * receives.
 *
 * @param {String} value
 * @return {String}
 */
const posixQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`

// what cmd reads as more than part of a word, and what a word of ours may hold
// without being quoted: the caret is the escape character, `&` `|` `<` `>` `(`
// `)` separate and redirect and group, `"` is the only quote cmd has, `%` and `!`
// are expanded before the word is looked at, `^` is the escape itself, and a
// space is the separator everything else is measured against. `,` `;` and `=`
// are left out too: cmd reads them as delimiters of its own.
const cmdSafeWord = /^[A-Za-z0-9@._/:-]+$/

/**
 * The characters cmd acts on even between double quotes.
 *
 * This is the whole of why the win32 rule is not "wrap it in quotes and be
 * done": cmd expands `%name%` while the line is being read and `!name!` when
 * delayed expansion is on (the session starts cmd with `/V:ON`, see
 * session.statusFrames), and neither of those phases looks at quotes. Everything
 * else cmd would act on — the separators, the redirections, the grouping
 * parentheses, the caret itself — is an ordinary character once it is inside
 * double quotes, which is where every word written here is.
 */
const cmdExpanded = /[%!]/g

/**
 * A value as one word of cmd.exe.
 *
 * Three things, in this order:
 *
 * - **The word is wrapped in double quotes.** That is what makes the separators
 *   (`&`, `|`, `<`, `>`, `(`, `)`) and the caret ordinary characters, so a path
 *   with ` & ` in it is one word rather than a command and a redirection.
 * - **A double quote inside it is doubled.** cmd passes the pair through and the
 *   receiving program's own command-line parser reads `""` between quotes as one
 *   `"` — which is how an argument that holds a quote survives. Doubling keeps
 *   the number of quote characters even, so cmd's own idea of whether it is
 *   inside a quoted section is not left flipped for the rest of the line.
 * - **A run of backslashes at the end is doubled.** A backslash means nothing to
 *   cmd, but the receiving program's parser treats one in front of the closing
 *   quote as escaping it, which eats the quote and takes the rest of the line
 *   with it. Doubling the run is what makes the parser hand back one.
 *
 * `%` and `!` are caret-escaped last, once the word exists: at an interactive
 * prompt that is what stops cmd expanding them (a `.bat` would need `%%`, which
 * is why nothing here is ever written to one). The value that carries either is
 * rare — a path holding a percent sign — but a path is exactly the value this
 * function exists for, and silently expanding it into somebody's environment
 * variable is worse than a caret that costs a character.
 *
 * What is not verifiable without windows: the caret's behaviour in front of `%`
 * and `!` inside double quotes, and cmd's exact handling of `""`. Both are the
 * documented reading of cmd's phases (and the rule `npm`'s own `.cmd` shims have
 * run on for years); the tests here pin the strings, not the shell's answer to
 * them.
 *
 * @param {String} value
 * @return {String}
 */
const cmdQuote = value => {
  const text = String(value)
  const doubled = text.replace(/"/g, '""')
  const tail = /\\+$/.test(doubled) ? '\\' : ''

  return `"${`${doubled}${tail}`.replace(cmdExpanded, '^$&')}"`
}

/**
 * A value as one word of the platform's shell, quoted only when it has to be.
 *
 * A word that cmd or a posix shell would read as one word anyway is left alone,
 * which is what keeps a container command readable — `docker exec -it app php
 * artisan tinker` rather than a line of quotes — and what every command builder
 * in this app wants for a name or a directory. A value that could be more than a
 * word is quoted whole.
 *
 * @param {String} value
 * @param {Platform} [platform]
 * @return {String}
 */
const shellWord = (value, platform = process.platform) => {
  const text = String(value)

  if (isWindows(platform)) {
    return cmdSafeWord.test(text) ? text : cmdQuote(text)
  }

  return /^[A-Za-z0-9@%+=:,._/-]+$/.test(text) ? text : posixQuote(text)
}

/**
 * A value as one word of the platform's shell, always quoted.
 *
 * For a command rather than a name: an unquoted command is several words to the
 * shell that is handed it, whatever it holds, so it is always quoted as the one
 * word it is.
 *
 * @param {String} value
 * @param {Platform} [platform]
 * @return {String}
 */
const shellQuote = (value, platform = process.platform) =>
  (isWindows(platform) ? cmdQuote(value) : posixQuote(value))

/**
 * The platform whose shell reads a command built for a connection.
 *
 * Two things decide it, and neither is this machine:
 *
 * - A connection over ssh runs its command in the far login shell, which is a
 *   posix shell on every host this app reaches. The line is built here, but it is
 *   read there, so it is quoted there — and this is decided before anything the
 *   caller passed, because no caller has a reason to quote an ssh line's remote
 *   words for windows. Only the ssh line itself — the one typed into this
 *   machine's shell — is quoted for this machine, and that is
 *   parseSSHCommand's own layer.
 * - A project in a container runs its command inside the container, which is a
 *   linux image: its `sh -c` payload is quoted for that shell even when the
 *   engine that reaches it is running on windows. That payload is quoted posix
 *   explicitly where it is built; the engine's own line around it is the part
 *   this function answers for.
 *
 * Everything else runs in this machine's own shell.
 *
 * @param {Record<String, any>} connection
 * @param {Platform} [platform] what the caller already knows, which wins when the
 *   connection does not reach another machine
 * @return {Platform}
 */
const connectionShell = (connection, platform = null) => {
  if (connection && connection.is_over_ssh) {
    return 'posix'
  }

  if (platform) {
    return platform
  }

  return process.platform
}

module.exports = {
  isWindows,
  posixQuote,
  cmdQuote,
  shellWord,
  shellQuote,
  connectionShell,
}
