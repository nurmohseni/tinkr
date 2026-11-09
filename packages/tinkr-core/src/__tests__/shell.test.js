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

  test('cmd.exe gets the word between double quotes, and the quotes are the only ones', () => {
    // a space is a separator outside quotes and an ordinary character inside
    // them, and the quotes are what makes one word of a path
    expect(shellQuote('a b', 'win32')).toBe('"a b"')
    // the separators and redirections lose their meaning inside quotes, so they
    // are not caret-escaped: a caret there would be a character php or docker got
    expect(shellQuote('a&b|c<d>e(f)g', 'win32')).toBe('"a&b|c<d>e(f)g"')
    // a caret is ordinary inside quotes for the same reason
    expect(shellQuote('a^b', 'win32')).toBe('"a^b"')
  })

  test('a quote inside a cmd word is doubled, so it ends nothing', () => {
    // the receiving program's parser reads "" between quotes as one quote, and
    // the pair keeps the number of quotes even for cmd itself
    expect(shellQuote('say "hi"', 'win32')).toBe('"say ""hi"""')
    expect(cmdQuote('"')).toBe('""""')
  })

  test('a percent or a bang is caret-escaped, which is what stops cmd expanding it', () => {
    // these two are expanded before quotes are looked at, on every platform's
    // rule that matters here: %PATH% would otherwise become a machine's path
    expect(shellQuote('%PATH%', 'win32')).toBe('"^%PATH^%"')
    expect(shellQuote('C:\\100%\\bin', 'win32')).toBe('"C:\\100^%\\bin"')
    expect(shellQuote('a!b!', 'win32')).toBe('"a^!b^!"')
  })

  test('a run of backslashes at the end is doubled, so it does not eat the closing quote', () => {
    expect(shellQuote('C:\\srv\\', 'win32')).toBe('"C:\\srv\\\\"')
    expect(shellQuote('C:\\srv\\\\', 'posix')).toBe("'C:\\srv\\\\'")
  })

  test('a unicode value survives both', () => {
    expect(shellQuote('C:\\srv\\prøjekt', 'win32')).toBe('"C:\\srv\\prøjekt"')
    expect(shellQuote('prøjekt', 'posix')).toBe("'prøjekt'")
  })

  test('a cmd word that is already one word stays readable', () => {
    expect(shellWord('app-abc123', 'win32')).toBe('app-abc123')
    expect(shellWord('/var/www/html', 'win32')).toBe('/var/www/html')
    // % and ! are never safe, even when nothing else about the word is special
    expect(shellWord('100%', 'win32')).toBe('"100^%"')
    expect(shellWord('a b', 'win32')).toBe('"a b"')
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
