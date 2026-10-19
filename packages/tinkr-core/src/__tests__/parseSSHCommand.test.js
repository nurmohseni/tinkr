const {parseSSHCommand, sshArgs, sshProblem} = require('../parseSSHCommand')

// a connection whose fields are what a person typed into the form
// what bash reads a line back as, which is the only reader that matters: the
// session types its command into a shell, so the shell is what proves each value
// came through as one word rather than split, ended, or run
const {execFileSync} = require('child_process')

const words = line => {
  // the ssh binary is replaced by printf, and printf prints its own arguments as
  // bash split them: nothing connects, and nothing in the line is evaluated. The
  // helper's leading assignments stay, because they are what the shell reads
  // first and what the line is being checked for, and only a word that is the
  // command itself is swapped — a helper's path can hold `ssh` too
  const probe = line
    .split(' ')
    .map(word => (word === 'ssh' ? 'printf \'[%s]\'' : word))
    .join(' ')

  return execFileSync('/bin/bash', ['-c', probe], {encoding: 'utf8'})
}

const conn = (fields = {}) => Object.assign({
  ssh_server: '192.168.1.1',
  ssh_user: 'root',
}, fields)

describe('the session command', () => {
  test('reaches the connection with its port, key and user', () => {
    expect(parseSSHCommand(conn()))
      .toBe("ssh -t -- 'root@192.168.1.1' 'exec bash --login -i'")
    expect(parseSSHCommand(conn({ssh_port: '2000'})))
      .toBe("ssh -t -p '2000' -- 'root@192.168.1.1' 'exec bash --login -i'")
    expect(parseSSHCommand(conn({ssh_port: '2000', ssh_key: '/usr/local/id.pem'})))
      .toBe("ssh -t -p '2000' -i '/usr/local/id.pem' -- 'root@192.168.1.1' 'exec bash --login -i'")
  })

  // the bug this waits against: `-t` written after the target is not an option,
  // because ssh reads the first argument after the destination as the command to
  // run there. The far shell tried to run a program called `-t`, and the session
  // came back without a terminal — which is a login that never initializes
  test('puts every option before the target, where ssh reads them', () => {
    // bash splits the line exactly as it would for ssh, which is the only reader
    // that matters here
    expect(words(parseSSHCommand(conn({path: '/var/www/html', ssh_port: '2000'}))))
      .toBe('[-t][-p][2000][--][root@192.168.1.1][cd \'/var/www/html\' && exec bash --login -i]')

    // the target is the first word that is not an option — after its `--` — and
    // nothing after it is read as one, which is what `-t` written there used to
    // be
    const split = words(parseSSHCommand(conn({path: '/var/www/html'}))).split('][')

    expect(split.indexOf('root@192.168.1.1')).toBeGreaterThan(split.indexOf('-t'))
    expect(split.slice(split.indexOf('root@192.168.1.1') + 1).join('')).not.toContain('-t')
  })

  test('quotes the directory it lands in, so a path is one word', () => {
    const line = parseSSHCommand(conn({path: '/var/www/html'}))

    expect(line).toContain("'cd '\\''/var/www/html'\\'' && exec bash --login -i'")
  })

  // psysh draws a prompt only when its stdin is a terminal, so the far side is
  // given one (`-t`) and an interactive login shell to run in it
  test('gives the remote side a terminal and an interactive shell', () => {
    expect(parseSSHCommand(conn())).toMatch(/^ssh -t /)
    expect(parseSSHCommand(conn({path: '/var/www/html'}))).toContain('exec bash --login -i')
  })

  // the bug this waits against: the command was typed into the terminal ssh was
  // started on, so ssh's own questions read it instead. On a first connection
  // `Are you sure you want to continue connecting?` answered the command, and
  // the session it was for never began
  test('carries the command in the ssh line, where ssh questions cannot eat it', () => {
    const line = parseSSHCommand(conn({path: '/var/www/html'}), 'php artisan tinker')

    // the command is inside the one quoted word ssh is given as its remote
    // command, and bash reads it back as one argument
    expect(words(line))
      .toBe('[-t][--][root@192.168.1.1][cd \'/var/www/html\' && php artisan tinker]')
  })

  test('a path with a space stays one word, and a quote cannot open a string', () => {
    // `cd: too many arguments` and a shell sitting at a continuation prompt are
    // what these two used to be
    expect(parseSSHCommand(conn({path: '/home/qa/my app'})))
      .toContain("'\\''/home/qa/my app'\\''")

    // the path is inside a single quoted word, so a `;` in it is a character
    // rather than a statement: the shell the session types into reads one word
    // the path is inside a single quoted word, so a `;` in it is a character
    // rather than a statement: the shell the session types into reads one word
    const line = parseSSHCommand(conn({path: '/home/qa/app; touch /tmp/pwned'}))

    expect(line.startsWith("ssh -t -- 'root@192.168.1.1' 'cd '")).toBe(true)
    expect(line.endsWith("'")).toBe(true)
  })

  // the bug this waits against: the shell in front of ssh is a login shell, and
  // a profile that sets SSH_ASKPASS — a desktop's own askpass helper is one —
  // replaces what the pty's environment had. What is written on the line is read
  // after the profile has run, which is what makes the helper the app's
  test('puts the helper\'s variables on the line, after the login profile runs', () => {
    const line = parseSSHCommand(
      conn({ssh_password: true}),
      null,
      {SSH_ASKPASS: '/data/ssh/askpass.sh', SSH_ASKPASS_REQUIRE: 'force'},
    )

    expect(line.startsWith("SSH_ASKPASS='/data/ssh/askpass.sh' SSH_ASKPASS_REQUIRE='force' ssh -t")).toBe(true)

    // and they are assignments of a shell, so the first word the shell runs is
    // still ssh, with the target it was given
    expect(words(line))
      .toBe('[-t][--][root@192.168.1.1][exec bash --login -i]')
  })

  test('carries the options a password login needs, and none for a key', () => {
    expect(words(parseSSHCommand(conn({is_over_ssh: true, ssh_password: true}))))
      .toBe('[-t][-o][StrictHostKeyChecking=accept-new][-o][NumberOfPasswordPrompts=1][--][root@192.168.1.1][exec bash --login -i]')

    expect(parseSSHCommand(conn({is_over_ssh: true, ssh_key: '/keys/id'}))).not.toContain('StrictHostKeyChecking')
  })

  test('says why a connection ssh cannot be given is not used', () => {
    // a user or host that starts with `-` is read as an option, and
    // `-oProxyCommand=` runs a command; a host with a space or a slash is not a
    // host. None of it is escaped — it is refused, and the session says why
    expect(parseSSHCommand(conn({ssh_user: '-oProxyCommand=id'}))).toContain('cannot start with')
    expect(parseSSHCommand(conn({ssh_server: 'example.com; touch /tmp/x'}))).toContain('spaces or slashes')
    expect(parseSSHCommand(conn({ssh_port: '22; id'}))).toContain('has to be a number')
    expect(parseSSHCommand(conn({ssh_user: ''}))).toContain('needs a user and a server')

    // the refusal is a line the session can print, not one it runs
    expect(parseSSHCommand(conn({ssh_user: '-oProxyCommand=id'}))).toMatch(/^echo '/)
  })
})

describe('the arguments a command is run with', () => {
  test('are words of their own, with the target after --', () => {
    // these go to spawn('ssh', args): no shell reads them, so nothing splits,
    // and `--` is what stops a target that looks like an option being one
    expect(sshArgs(conn())).toEqual(['--', 'root@192.168.1.1'])
    expect(sshArgs(conn({ssh_port: '2000', ssh_key: '/keys/my key'})))
      .toEqual(['-p', '2000', '-i', '/keys/my key', '--', 'root@192.168.1.1'])
  })

  test('report what is wrong with a connection rather than guessing', () => {
    expect(sshProblem(conn())).toBe(null)
    expect(sshProblem(conn({ssh_server: 'example.com'}))).toBe(null)
    expect(sshProblem(conn({ssh_user: '-oProxyCommand=id'}))).toMatch(/cannot start with/)
  })
})
