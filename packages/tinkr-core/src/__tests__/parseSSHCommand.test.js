const {parseSSHCommand, sshArgs, sshProblem} = require('../parseSSHCommand')

// a connection whose fields are what a person typed into the form
// what bash reads a line back as, which is the only reader that matters: the
// session types its command into a shell, so the shell is what proves each value
// came through as one word rather than split, ended, or run
const {execFileSync} = require('child_process')

const words = line => {
  // the ssh binary is replaced by printf, and printf prints its own arguments as
  // bash split them: nothing connects, and nothing in the line is evaluated
  const probe = line.replace(/^ssh/, 'printf \'[%s]\'')

  return execFileSync('/bin/bash', ['-c', probe], {encoding: 'utf8'})
}

const conn = (fields = {}) => Object.assign({
  ssh_server: '192.168.1.1',
  ssh_user: 'root',
}, fields)

describe('the session command', () => {
  test('reaches the connection with its port, key and user', () => {
    expect(parseSSHCommand(conn())).toBe("ssh -- 'root@192.168.1.1'")
    expect(parseSSHCommand(conn({ssh_port: '2000'}))).toBe("ssh -p '2000' -- 'root@192.168.1.1'")
    expect(parseSSHCommand(conn({ssh_port: '2000', ssh_key: '/usr/local/id.pem'})))
      .toBe("ssh -p '2000' -i '/usr/local/id.pem' -- 'root@192.168.1.1'")
  })

  test('quotes the directory it lands in, so a path is one word', () => {
    const line = parseSSHCommand(conn({path: '/var/www/html'}))

    expect(line).toContain("-t 'cd '\\''/var/www/html'\\'';bash --login'")
  })

  test('a path with a space stays one word, and a quote cannot open a string', () => {
    // `cd: too many arguments` and a shell sitting at a continuation prompt are
    // what these two used to be
    expect(parseSSHCommand(conn({path: '/home/qa/my app'})))
      .toContain("'\\''/home/qa/my app'\\''")

    // the path is inside a single quoted word, so a `;` in it is a character
    // rather than a statement: the shell the session types into reads one word
    expect(words(parseSSHCommand(conn({path: '/home/qa/app; touch /tmp/pwned'}))))
      .toBe('[--][root@192.168.1.1][-t][cd \'/home/qa/app; touch /tmp/pwned\';bash --login]')
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
