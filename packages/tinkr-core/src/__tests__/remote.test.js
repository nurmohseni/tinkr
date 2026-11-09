jest.mock('child_process', () => ({spawn: jest.fn()}))

const {EventEmitter} = require('events')
const {spawn} = require('child_process')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

const realSpawn = jest.requireActual('child_process').spawn

const {quoted, exec, ensureMaster, closeMasters} = require('../remote')
const {controlOptions, masterOptions, controlPath, sshArgs} = require('tinkr-core')

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

// a child that writes past what it is allowed to keep, and keeps writing
const overflowing = chunks => {
  const child = new EventEmitter()

  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = jest.fn()

  process.nextTick(() => {
    for (const chunk of chunks) {
      child.stdout.emit('data', chunk)
    }
  })

  return child
}

const alive = pid => {
  try {
    process.kill(pid, 0)
  } catch (error) {
    return error.code === 'EPERM'
  }

  // a zombie has stopped and is only waiting to be reaped: it is not running
  // anything any more
  try {
    return !/\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch (error) {
    return process.platform !== 'linux'
  }
}

const waitFor = async predicate => {
  for (let i = 0; i < 80; i++) {
    if (predicate()) {
      return true
    }

    await new Promise(resolve => setTimeout(resolve, 50))
  }

  return predicate()
}

// a socket with no master on it: the check is the first thing the app asks of
// ssh, and `-O check` exits 1 when nothing answers on the path
const socketIsFree = () => spawn.mockImplementationOnce(() => answering('', 1))

describe('running a command on the machine a connection runs on', () => {
  beforeEach(() => {
    // a master is a login this app made and kept, and it outlives a command: a
    // test is not one connection's, so none is left for the next
    spawn.mockImplementation(() => answering(''))
    closeMasters()
    spawn.mockReset()
  })

  test('is ssh there, reached with the port, the key and the target of the connection', async () => {
    spawn.mockImplementation(() => answering(''))
    socketIsFree()

    const connection = {
      is_over_ssh: true,
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
      ssh_port: '2000',
      ssh_key: '/usr/local/id.pem',
      path: '/var/www/html',
    }

    await exec(connection, 'php -v')

    // each argument is one word of its own, and `--` is what stops a target that
    // looks like an option from being read as one
    expect(spawn).toHaveBeenLastCalledWith('ssh', [
      ...controlOptions(connection),
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
    socketIsFree()

    const connection = {is_over_ssh: true, ssh_server: '192.168.1.1', ssh_user: 'root'}

    await exec(connection, 'php -v')

    expect(spawn).toHaveBeenLastCalledWith('ssh', [...controlOptions(connection), '--', 'root@192.168.1.1', 'php -v'])
  })

  // logging in is what a command over ssh spends its time on, so the login is
  // made once, by the connection, and every command after it travels down the
  // socket that is left behind (see sshControl)
  test('opens the connection before the command that needs it, and travels down it', async () => {
    spawn.mockImplementation(() => answering(''))
    socketIsFree()

    const connection = {is_over_ssh: true, ssh_server: '192.168.1.1', ssh_user: 'root'}

    await exec(connection, 'php -v')

    expect(spawn).toHaveBeenNthCalledWith(2, 'ssh',
      ['-f', '-N', ...masterOptions(connection), '--', 'root@192.168.1.1'],
      {stdio: 'ignore'})

    // the next command of the same connection finds it open rather than waiting
    // on another login: it asks the socket, and travels down what answers
    spawn.mockClear()

    await exec(connection, 'php -v')

    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([
      ['-O', 'check', ...sshArgs(connection)],
      [...controlOptions(connection), '--', 'root@192.168.1.1', 'php -v'],
    ])
  })

  // a login that outlived the app that made it is a socket to use, and asking
  // ssh to become a master on one that is taken does not fail: it stops
  // multiplexing and sits on a connection of its own, which is a login nobody
  // closes
  test('uses a login that was already there rather than making a second one', async () => {
    spawn.mockImplementation(() => answering('', 0))

    const connection = {is_over_ssh: true, ssh_server: '192.168.1.1', ssh_user: 'root'}

    expect(await ensureMaster(connection)).toBe(true)

    spawn.mockClear()

    await exec(connection, 'php -v')

    // asked, then travelled down: no second login, and no `-f` to make one
    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([
      ['-O', 'check', ...sshArgs(connection)],
      [...controlOptions(connection), '--', 'root@192.168.1.1', 'php -v'],
    ])

    // it is not this app's login to end, so leaving does not end it
    spawn.mockClear()
    closeMasters()

    expect(spawn).not.toHaveBeenCalled()
  })

  // a master is ended by signal rather than asked to leave: ssh's own exit
  // request ends one between sessions, and one asked while a session is still
  // open keeps the connection with no socket left to ask again on
  test('ends the login it made when the app leaves', async () => {
    spawn.mockImplementation(() => answering(''))
    socketIsFree()

    const connection = {is_over_ssh: true, ssh_server: '192.168.1.1', ssh_user: 'root'}

    expect(await ensureMaster(connection)).toBe(true)

    spawn.mockClear()
    closeMasters()

    expect(spawn).toHaveBeenCalledWith(
      'pkill',
      ['-TERM', '-f', `ControlPath=${controlPath(connection)}`],
      {stdio: 'ignore'},
    )

    // the login is not one this app travels down any more, so leaving twice
    // ends it once
    spawn.mockClear()
    closeMasters()

    expect(spawn).not.toHaveBeenCalled()
  })

  // a socket no master answers on is a master that died without cleaning up,
  // and ssh connects without multiplexing rather than use a path it cannot
  test('removes a socket no master answers on before starting the master', async () => {
    if (process.platform === 'win32') {
      return
    }

    const connection = {is_over_ssh: true, ssh_server: '192.168.1.1', ssh_user: 'root'}
    const socket = controlPath(connection)
    const stale = net.createServer()

    await new Promise(resolve => stale.listen(socket, resolve))

    socketIsFree()

    let whileStarting = null

    spawn.mockImplementationOnce(() => {
      whileStarting = fs.existsSync(socket)

      return answering('', 0)
    })

    expect(await ensureMaster(connection)).toBe(true)
    expect(whileStarting).toBe(false)
    expect(fs.existsSync(socket)).toBe(false)

    await new Promise(resolve => stale.close(resolve))
  })

  test('runs the command anyway when the login does not happen', async () => {
    // a machine that refuses multiplexing, an ssh that is not there: the command
    // is slower, never absent
    spawn.mockImplementation(() => answering('', 255))
    socketIsFree()

    const connection = {is_over_ssh: true, ssh_server: '192.168.1.1', ssh_user: 'root'}

    expect(await ensureMaster(connection)).toBe(false)

    spawn.mockImplementation(() => answering('PHP 8.3.1 (cli)'))

    const answer = await exec(connection, 'php -v')

    expect(answer.stdout).toBe('PHP 8.3.1 (cli)')
    expect(spawn).toHaveBeenLastCalledWith('ssh', [...controlOptions(connection), '--', 'root@192.168.1.1', 'php -v'])
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

    // the child a cancelled command leaves behind ends, which is when the
    // escalation a timeout scheduled has nothing left to wait for
    running.emit('close', null)
  })

  test('stops keeping an answer that is over its cap, and drops what comes after it', async () => {
    let running = null

    spawn.mockImplementation(() => {
      running = overflowing(['12345', '67890', 'late'])

      return running
    })

    const answer = await exec({path: '/var/www/app'}, 'php -r echo;', {maxBuffer: 6})

    // the first chunk fit, the second one did not: the answer is what was kept,
    // and nothing written after the cap was added to it
    expect(answer).toEqual({stdout: '12345', stderr: '', code: null})

    running.emit('close', null)
  })

  test('writes a value as one word of a shell', () => {
    expect(quoted("/var/www/it's here")).toBe("'/var/www/it'\\''s here'")
    // the platform is a parameter, because the shell that reads the value is not
    // always this machine's: a windows one gets cmd's word
    expect(quoted('C:\\srv\\my app', 'win32')).toBe('"C:\\srv\\my app"')
    expect(quoted('100%', 'win32')).toBe('"100^%"')
  })
})

// a local read on a windows app: there is no /bin/sh there, which is why every
// index, log and container listing came back empty and said nothing about it
describe('running a local command on a windows machine', () => {
  beforeEach(() => {
    spawn.mockImplementation(() => answering(''))
    closeMasters()
    spawn.mockReset()
  })

  test('runs it in cmd, as one quoted argument after /c', async () => {
    spawn.mockImplementation(() => answering('PHP 8.4.0'))

    const answer = await exec(
      {path: 'C:\\srv\\my app'},
      'php -r "echo 1;"',
      {platform: 'win32'},
    )

    // `/s` is what makes cmd strip the quotes it was handed and use the rest as
    // it is, and `windowsVerbatimArguments` keeps node from quoting the line a
    // second time; the working directory is the connection's, as it is on posix
    expect(spawn).toHaveBeenCalledWith(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', '"php -r "echo 1;""'],
      {cwd: 'C:\\srv\\my app', windowsVerbatimArguments: true},
    )
    expect(answer).toEqual({stdout: 'PHP 8.4.0', stderr: '', code: 0})
  })

  test('is not made a process group, because windows has nothing to signal', async () => {
    spawn.mockImplementation(() => answering(''))

    await exec({path: 'C:\\srv'}, 'php -v', {platform: 'win32'})

    // a posix read is spawned detached so a stop reaches what it left running;
    // cmd has no such group, and the option is left out rather than passed false
    expect(spawn.mock.calls[0][2]).not.toHaveProperty('detached')
  })

  test('still quotes the far side of an ssh command as posix, whatever this machine is', async () => {
    spawn.mockImplementation(() => answering(''))
    socketIsFree()

    const connection = {
      is_over_ssh: true,
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
      path: "/srv/it's here",
    }

    await exec(connection, 'php -v', {platform: 'win32'})

    // the line is handed to ssh as one argument, and the far login shell is a
    // posix shell: its `cd` is quoted for that shell, not for cmd
    expect(spawn).toHaveBeenLastCalledWith('ssh', [
      ...controlOptions(connection),
      '--',
      'root@192.168.1.1',
      "cd '/srv/it'\\''s here' && php -v",
    ])
  })
})

const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

describeOnPosix('stopping a command on this machine for real', () => {
  let dir = null

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-remote-'))
    // these tests run the shell the way the app does, rather than a fake one
    spawn.mockImplementation(realSpawn)
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  const pidFrom = async file => {
    await waitFor(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() !== '')

    return Number(fs.readFileSync(file, 'utf8').trim())
  }

  test('stops the shell and what it started when it runs out of time', async () => {
    const pidFile = path.join(dir, 'timeout.pid')

    // the shell that is spawned waits on a child of its own, and that child
    // records itself and becomes the sleep. Killing only the spawned shell
    // would leave the sleep behind, which is what the timeout has to reach
    const answer = await exec({path: dir}, `sh -c 'echo $$ > ${pidFile}; exec sleep 30' & wait`, {timeout: 200})

    expect(answer.code).toBeNull()

    const pid = await pidFrom(pidFile)

    expect(await waitFor(() => !alive(pid))).toBe(true)
  }, 15000)

  test('stops the shell and what it started when the answer is over its cap', async () => {
    const pidFile = path.join(dir, 'overflow.pid')

    // the spawned shell waits on the child that writes the answer, so the
    // answer over the cap has to reach the child and not only the shell
    const answer = await exec({path: dir}, `sh -c 'echo $$ > ${pidFile}; exec yes x' & wait`, {maxBuffer: 1024, timeout: 0})

    expect(answer.code).toBeNull()
    expect(answer.stdout.length).toBeLessThanOrEqual(1024)

    const pid = await pidFrom(pidFile)

    expect(await waitFor(() => !alive(pid))).toBe(true)
  }, 15000)

  test('kills a descendant that ignores the TERM once the grace is over', async () => {
    const pidFile = path.join(dir, 'trapped.pid')

    // the outer shell waits on a shell that traps TERM: the TERM leaves the
    // inner one running, which is what the KILL after the grace is for
    const command = `sh -c 'echo $$ > ${pidFile}; trap "" TERM; while :; do sleep 1; done' & wait`

    const answer = await exec({path: dir}, command, {timeout: 300})

    expect(answer.code).toBeNull()

    const pid = await pidFrom(pidFile)

    expect(await waitFor(() => !alive(pid))).toBe(true)
  }, 15000)
})
