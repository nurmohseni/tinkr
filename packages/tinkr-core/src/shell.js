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
 * The characters cmd acts on in a line it reads.
 *
 * `^` is the escape itself; `&` `|` `<` `>` separate, pipe and redirect; `(`
 * `)` group; `"` is the only quote cmd has; a space ends a word; `*` `?` `[` `]`
 * are the pattern a wildcard or a `for` set reads; a backtick is what some
 * builtins take as a command; `,` `;` `=` are delimiters of cmd's own; and `%`
 * is expanded while the line is being read, before any of the rest is looked at.
 *
 * `!` is not here: it is expanded in a later phase, and only by a cmd started
 * with `/V:ON`, so how many carets it takes depends on the shell that reads the
 * word rather than on the word (see cmdQuote).
 */
const cmdSpecial = /([()%^"`<>&|;, *?[\]])/g

/**
 * A value in the form the program's own command-line parser reads as one
 * argument.
 *
 * That parser is the C runtime's, and it is the same one in every program built
 * with MSVC — php.exe, and a node.exe built for windows. It splits a line on
 * spaces that are not quoted, reads a run of backslashes as itself unless a `"`
 * follows it, where half of them are the backslashes and the last one escapes
 * the quote, and takes a `"` outside a quoted run as the start of one. So the
 * one spelling it turns back into the value: any `"` in the value is written as
 * `\"` with the backslashes before it doubled, a run of backslashes at the end
 * is doubled as well, and the whole is wrapped in quotes.
 *
 * @param {String} value
 * @return {String}
 */
const crtQuote = value => {
  const text = String(value)
  let out = '"'
  let slashes = 0

  for (const char of text) {
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

/**
 * A value as one word of cmd.exe.
 *
 * cmd does not hand a program the words of a line: it hands it the line, and the
 * program splits that again by its own rules. So a word is written twice — once
 * so cmd passes it on unchanged, and once so the program reads the one argument
 * in it — and the two spellings are the two halves of this function.
 *
 * The value is put in the form the program's parser reads (see crtQuote), and
 * then every character cmd acts on is caret-escaped, the quotes of that form
 * included. Escaping the quotes is what keeps cmd out of quote mode altogether,
 * and that is the whole reason the rule is this and not "wrap it in quotes":
 * inside quotes the caret is an ordinary character, `%name%` and `!name!` are
 * expanded anyway, and a `"` in the value ends the quoted run in the middle of
 * the word. Outside quotes one caret escapes one character and is removed,
 * `^%` is a percent that is not the name of a variable at the prompt, and the
 * program is handed the quotes and spaces of the form it reads.
 *
 * `!` is the one character whose escaping belongs to the shell rather than to the
 * value. cmd expands it only with delayed expansion on — `/V:ON`, which is how the
 * session's shell is started (see session.statusFrames) and how a line given to
 * `cmd /d /s /c` is not. With it on, the caret phase consumes one caret and the
 * delayed phase the other, so the word needs `^^!`; with it off, `^!` is what
 * survives both phases as one bang. `options.delayed` says which shell reads the
 * word, and every caller knows: the session types its line at a `/V:ON` prompt,
 * and a read is given to `/s /c`.
 *
 * A caret of the value's own is read in those same two phases, so it takes one
 * escape for each as well. With delayed expansion on it is written as four
 * carets rather than two: two are read by the parse as one, and the one that is
 * left still escapes whatever follows it while the delayed phase reads the line,
 * which is how `caret^x` reached the program as `caretx`. Four carets are read
 * as two by the parse and as one by the delayed phase, which is the caret the
 * value had. Four carets were read back as one on a real cmd started with
 * `/V:ON`, which is what the count is taken from rather than from reasoning
 * about the two phases.
 *
 * @param {String} value
 * @param {{delayed?: Boolean}} [options] whether the cmd that reads the word was
 *   started with delayed expansion on
 * @return {String}
 */
const cmdQuote = (value, {delayed = false} = {}) => crtQuote(value)
  .replace(cmdSpecial, char => (char === '^' ? (delayed ? '^^^^' : '^^') : `^${char}`))
  .replace(/!/g, delayed ? '^^!' : '^!')

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
 * @param {{delayed?: Boolean}} [options] whether the cmd that reads the word was
 *   started with delayed expansion on (see cmdQuote)
 * @return {String}
 */
const shellWord = (value, platform = process.platform, options = {}) => {
  const text = String(value)

  if (isWindows(platform)) {
    return cmdSafeWord.test(text) ? text : cmdQuote(text, options)
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
 * @param {{delayed?: Boolean}} [options] whether the cmd that reads the word was
 *   started with delayed expansion on (see cmdQuote)
 * @return {String}
 */
const shellQuote = (value, platform = process.platform, options = {}) =>
  (isWindows(platform) ? cmdQuote(value, options) : posixQuote(value))

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
