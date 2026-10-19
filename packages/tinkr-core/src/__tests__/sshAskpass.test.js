const fs = require('fs')
const os = require('os')
const path = require('path')
const {execFileSync} = require('child_process')

const {
  secretsFile,
  helperFile,
  writeHelper,
  usesPassword,
  passwordArgs,
  askpassEnvironment,
} = require('../sshAskpass')

const connection = (fields = {}) => Object.assign({
  id: 'c1',
  is_over_ssh: true,
  ssh_user: 'root',
  ssh_server: 'db.example.com',
}, fields)

// a data directory of the test's own, so nothing is written where the app keeps
// its own files
const freshDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-askpass-'))

  fs.mkdirSync(path.join(dir, 'app'), {recursive: true})
  fs.writeFileSync(secretsFile(dir), JSON.stringify({c1: 'hunter2'}), {mode: 0o600})

  return dir
}

// what the helper answers, run the way ssh runs it: the script, and the prompt
// as its last argument
const answer = (dir, prompt, who = 'root@db.example.com') => {
  writeHelper(dir)

  return execFileSync(process.execPath, [helperFile(dir), prompt], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      TINKR_SSH_SECRET_FILE: secretsFile(dir),
      TINKR_SSH_SECRET_ID: 'c1',
      TINKR_SSH_SECRET_WHO: who,
    }),
  }).replace(/\n$/, '')
}

describe('a connection with a saved password', () => {
  let dir = null

  beforeEach(() => {
    dir = freshDir()
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  test('answers the password prompt of its own account', () => {
    expect(answer(dir, "root@db.example.com's password: ")).toBe('hunter2')
  })

  // the bug this waits against: the session's shell inherits the environment, so
  // a `ssh other-server` typed into the app's terminal was handed this
  // connection's password
  test('answers no prompt that is not this connection\'s own', () => {
    expect(answer(dir, "admin@db.example.com's password: ")).toBe('')
    expect(answer(dir, "root@other.example.com's password: ")).toBe('')
  })

  // a key's passphrase and a second factor come through the same call, and the
  // account's password is not an answer to either
  test('answers neither a key passphrase nor a second factor', () => {
    expect(answer(dir, "Enter passphrase for key '/root/.ssh/id_ed25519': ")).toBe('')
    expect(answer(dir, 'Verification code: ')).toBe('')
  })

  // the host key is accepted by `accept-new`, and one that *changed* is the
  // question that has to keep failing
  test('refuses a host key it is asked about', () => {
    expect(answer(dir, 'Are you sure you want to continue connecting (yes/no/[fingerprint])? ')).toBe('no')
  })

  // the helper is preloaded into a binary, and that binary is every node the
  // session starts: a script path is not a prompt
  test('leaves a process that is not a prompt alone', () => {
    expect(answer(dir, '/home/someone/script.js')).toBe('')
    expect(answer(dir, '')).toBe('')
  })

  test('answers an empty password rather than failing when the secret is gone', () => {
    fs.rmSync(secretsFile(dir))

    expect(answer(dir, "root@db.example.com's password: ")).toBe('')
  })

  // what ssh is given: the two options a password login needs, and nothing for a
  // connection that has a key instead
  test('is reached with the options that make one prompt answerable', () => {
    expect(passwordArgs(connection({ssh_password: true})))
      .toEqual(['-o', 'StrictHostKeyChecking=accept-new', '-o', 'NumberOfPasswordPrompts=1'])
    expect(passwordArgs(connection())).toEqual([])
    expect(passwordArgs(connection({ssh_password: true, is_over_ssh: false}))).toEqual([])
    expect(usesPassword(connection({ssh_password: true}))).toBe(true)
  })
})

describe('what a session over ssh is given for a password', () => {
  let dir = null

  beforeEach(() => {
    dir = freshDir()
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  // the two halves, and why they are two: the environment is replaced by a login
  // profile that sets SSH_ASKPASS, and an assignment on the line survives it
  test('names the helper in the environment and again on the line', () => {
    const askpass = askpassEnvironment(dir, connection({ssh_password: true}))

    // the binary ssh spawns: the app's own, with the helper preloaded on
    // windows, and a shim that runs the helper on posix
    expect(askpass.env.SSH_ASKPASS).toBe(process.platform === 'win32'
      ? process.execPath
      : path.join(dir, 'ssh', 'askpass.sh'))
    expect(askpass.env.SSH_ASKPASS_REQUIRE).toBe('force')
    expect(Object.keys(askpass.line).sort()).toEqual(Object.keys(askpass.env).sort())
  })

  test('carries no password, only where one is', () => {
    const askpass = askpassEnvironment(dir, connection({ssh_password: true}))
    const written = JSON.stringify([askpass.env, askpass.line])

    expect(written).not.toContain('hunter2')
    expect(askpass.env.TINKR_SSH_SECRET_ID).toBe('c1')
    expect(askpass.env.TINKR_SSH_SECRET_WHO).toBe('root@db.example.com')
  })

  test('is nothing at all for a connection without one', () => {
    expect(askpassEnvironment(dir, connection())).toBe(null)
    expect(askpassEnvironment(null, connection({ssh_password: true}))).toBe(null)
  })

  // the id is how the secret is found: a connection with a password and no id
  // would send the helper looking for a connection called `undefined`, and would
  // answer nothing — silently, which is the worst way to be wrong
  test('is nothing for a connection with a password but no id', () => {
    const anonymous = connection({ssh_password: true})

    delete anonymous.id

    expect(askpassEnvironment(dir, anonymous)).toBe(null)
  })

  // the helper is a program ssh spawns, so it has to be one: on posix a shim it
  // can exec, and the files are readable only by their owner
  test('leaves a helper only its owner can run or read', () => {
    const helper = writeHelper(dir)
    const file = path.resolve(helper.askpass)

    expect(fs.existsSync(file)).toBe(true)

    // windows has no mode bits, and its own file permissions instead
    const modes = process.platform === 'win32'
      ? []
      : [
          fs.statSync(file).mode & 0o777,
          fs.statSync(helperFile(dir)).mode & 0o777,
          fs.statSync(path.dirname(helperFile(dir))).mode & 0o777,
        ]

    expect(modes).toEqual(process.platform === 'win32' ? [] : [0o700, 0o600, 0o700])
  })
})
