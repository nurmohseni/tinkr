const {isWindows, posixQuote, cmdQuote, shellWord, shellQuote, connectionShell} = require('../shell')

// what cmd does to a word between double quotes is the shell's business and not
// this file's: what is asserted here is the string the app writes, which is the
// one part of windows support that is checkable without windows
describe('a value as one word of a shell', () => {
  test('a posix shell gets the word between single quotes, as it always did', () => {
    expect(shellQuote('a b')).toBe("'a b'")
    expect(shellQuote("it's here")).toBe("'it'\\''s here'")
    expect(shellQuote('%PATH%')).toBe("'%PATH%'")
    expect(shellQuote('a&b|^c')).toBe("'a&b|^c'")
    expect(shellQuote('')).toBe("''")
    expect(posixQuote('héllo wörld')).toBe("'héllo wörld'")
  })

  test('a posix word that needs nothing is left alone by shellWord', () => {
    expect(shellWord('app-abc123')).toBe('app-abc123')
    expect(shellWord('/srv/my app')).toBe("'/srv/my app'")
    expect(shellWord('/srv/app', 'posix')).toBe('/srv/app')
  })

  test('a cmd word is written for cmd and for the program it is handed to', () => {
    // cmd does not hand a program the words of a line — it hands it the line, and
    // the program splits that again. So a word is written twice: the form the
    // program's parser reads as one argument, and then a caret before every
    // character cmd would act on, the quotes of that form included. Escaping the
    // quotes is what keeps cmd out of quote mode, where the caret is a character
    // and a `%` or a `!` is expanded anyway
    expect(shellQuote('a b', 'win32')).toBe('^"a^ b^"')
    expect(shellQuote('a&b|c<d>e(f)g', 'win32')).toBe('^"a^&b^|c^<d^>e^(f^)g^"')
    expect(shellQuote('a^b', 'win32')).toBe('^"a^^b^"')
    expect(shellQuote('trail\\', 'win32')).toBe('^"trail\\\\^"')
    expect(shellQuote('', 'win32')).toBe('^"^"')
  })

  test('a quote inside a cmd word is escaped for both readers', () => {
    // `\"` is one quote to the program's parser and the caret is what hands it
    // that backslash and quote as themselves
    expect(shellQuote('say "hi"', 'win32')).toBe('^"say^ \\^"hi\\^"^"')
    expect(cmdQuote('"')).toBe('^"\\^"^"')
  })

  test('a percent is caret-escaped, which is what stops cmd expanding it', () => {
    // `%name%` is expanded while the line is read, before any escape is acted on,
    // and the caret is what makes it a percent rather than the name of a variable
    expect(shellQuote('%PATH%', 'win32')).toBe('^"^%PATH^%^"')
    expect(shellQuote('C:\\100%\\bin', 'win32')).toBe('^"C:\\100^%\\bin^"')
  })

  test('a bang takes one caret or two, and which one is the shell\'s to say', () => {
    // a line handed to `cmd /d /s /c` — what a read is given — has delayed
    // expansion off: the escape phase takes the one caret and nothing reads the
    // bang after it
    expect(shellQuote('a!b!', 'win32')).toBe('^"a^!b^!^"')
    // the session's shell is started with `/V:ON`, and there the delayed phase
    // reads the bang after the escape phase has taken a caret: two of them are
    // what one bang survives both phases with
    expect(shellQuote('a!b!', 'win32', {delayed: true})).toBe('^"a^^!b^^!^"')
    expect(cmdQuote('!', {delayed: true})).toBe('^"^^!^"')
    // the flag is a windows one, and a posix word does not know it is there
    expect(shellQuote('a!b!', 'posix', {delayed: true})).toBe("'a!b!'")
  })

  test('a caret of the value\'s own takes an escape for each phase, as a bang does', () => {
    // a line handed to `cmd /d /s /c` reads the caret in one phase: two carets
    // are the one the value had
    expect(shellQuote('a^b', 'win32')).toBe('^"a^^b^"')
    expect(cmdQuote('caret^x')).toBe('^"caret^^x^"')
    // the session's shell reads it in two — the parse and the delayed phase —
    // and two carets are read as an escape for what follows them, which is how
    // `caret^x` reached the program as `caretx`. Four are read as one caret
    expect(shellQuote('caret^x', 'win32', {delayed: true})).toBe('^"caret^^^^x^"')
    expect(cmdQuote('x^', {delayed: true})).toBe('^"x^^^^^"')
    expect(cmdQuote('^x', {delayed: true})).toBe('^"^^^^x^"')
    expect(cmdQuote('two^^carets', {delayed: true})).toBe('^"two^^^^^^^^carets^"')
    // an escape the function writes itself is not doubled: the `&` still takes
    // the one caret cmd removes, and the caret before it is the value's
    expect(cmdQuote('a&b^c', {delayed: true})).toBe('^"a^&b^^^^c^"')
  })

  test('a run of backslashes at the end is doubled, so it does not eat the closing quote', () => {
    expect(cmdQuote('C:\\srv\\')).toBe('^"C:\\srv\\\\^"')
    expect(shellQuote('C:\\srv\\\\', 'win32')).toBe('^"C:\\srv\\\\\\\\^"')
    expect(shellQuote('C:\\srv\\\\', 'posix')).toBe("'C:\\srv\\\\'")
  })

  test('a unicode value survives both', () => {
    expect(shellQuote('C:\\srv\\prøjekt', 'win32')).toBe('^"C:\\srv\\prøjekt^"')
    expect(shellQuote('ü x', 'win32')).toBe('^"ü^ x^"')
    expect(shellQuote('prøjekt', 'posix')).toBe("'prøjekt'")
  })

  test('a cmd word that is already one word stays readable', () => {
    expect(shellWord('app-abc123', 'win32')).toBe('app-abc123')
    expect(shellWord('/var/www/html', 'win32')).toBe('/var/www/html')
    // % and ! are never safe, even when nothing else about the word is special
    expect(shellWord('100%', 'win32')).toBe('^"100^%^"')
    expect(shellWord('a b', 'win32')).toBe('^"a^ b^"')
  })

  test('the platform name is a parameter rather than this machine', () => {
    expect(isWindows('win32')).toBe(true)
    expect(isWindows('linux')).toBe(false)
    // the same value twice, two shells: this is the whole of what the app
    // decides when it builds a line for a machine it is not on
    expect(shellQuote('a b', 'win32')).not.toBe(shellQuote('a b', 'linux'))
  })

  test('the shell that reads a line is the far one for a connection over ssh', () => {
    // the line is built here and read there, so a windows caller still gets posix
    // words for anything that travels
    expect(connectionShell({is_over_ssh: true}, 'win32')).toBe('posix')
    expect(connectionShell({}, 'win32')).toBe('win32')
    expect(connectionShell({}, null)).toBe(process.platform)
  })
})
