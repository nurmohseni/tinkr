jest.mock('child_process', () => ({spawn: jest.fn()}))

const {EventEmitter} = require('events')
const {spawn} = require('child_process')

const {quoted, exec} = require('../remote')

// a child that says what it was going to say once the listeners are on it, which
// is when a real one says it too
const answering = (out, code = 0, err = '') => {
  const child = new EventEmitter()

  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = jest.fn()

  process.nextTick(() => {
    if (out) {
      child.stdout.emit('data', out)
    }

    if (err) {
      child.stderr.emit('data', err)
    }

    child.emit('close', code)
  })

  return child
}

// a child that wrote something and then went quiet, which is a connection that
// is not going to answer
const quiet = out => {
  const child = new EventEmitter()

  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = jest.fn()

  process.nextTick(() => child.stdout.emit('data', out))

  return child
}

describe('running a command on the machine a connection runs on', () => {
  beforeEach(() => spawn.mockReset())

  test('is a shell here, in the project\'s own directory', async () => {
    spawn.mockImplementation(() => answering('PHP 8.3.1 (cli)'))

    const answer = await exec({path: '/var/www/app'}, 'php -v')

    expect(spawn).toHaveBeenCalledWith('/bin/sh', ['-lc', 'php -v'], {cwd: '/var/www/app'})
    expect(answer).toEqual({stdout: 'PHP 8.3.1 (cli)', stderr: '', code: 0})
  })

  test('is ssh there, reached with the port, the key and the target of the connection', async () => {
    spawn.mockImplementation(() => answering(''))

    await exec({
      is_over_ssh: true,
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
      ssh_port: '2000',
      ssh_key: '/usr/local/id.pem',
      path: '/var/www/html',
    }, 'php -v')

    // each argument is one word of its own, and `--` is what stops a target that
    // looks like an option from being read as one
    expect(spawn).toHaveBeenCalledWith('ssh', [
      '-p',
      '2000',
      '-i',
      '/usr/local/id.pem',
      '--',
      'root@192.168.1.1',
      "cd '/var/www/html' && php -v",
    ])
  })

  test('does not enter a directory of a connection that has none', async () => {
    spawn.mockImplementation(() => answering(''))

    await exec({is_over_ssh: true, ssh_server: '192.168.1.1', ssh_user: 'root'}, 'php -v')

    expect(spawn).toHaveBeenCalledWith('ssh', ['--', 'root@192.168.1.1', 'php -v'])
  })

  test('says what a command exited with rather than failing on it', async () => {
    spawn.mockImplementation(() => answering('', 2, 'no such file or directory'))

    const answer = await exec({path: '/var/www/app'}, 'php -r 1;')

    expect(answer.code).toBe(2)
    expect(answer.stderr).toBe('no such file or directory')
  })

  test('answers with what was written before a command that never finished was killed', async () => {
    let running = null

    spawn.mockImplementation(() => {
      running = quiet('partial')

      return running
    })

    const answer = await exec({path: '/var/www/app'}, 'php -r sleep;', {timeout: 20})

    expect(answer).toEqual({stdout: 'partial', stderr: '', code: null})
    expect(running.kill).toHaveBeenCalled()
  })

  test('writes a value as one word of a shell', () => {
    expect(quoted("/var/www/it's here")).toBe("'/var/www/it'\\''s here'")
  })
})
