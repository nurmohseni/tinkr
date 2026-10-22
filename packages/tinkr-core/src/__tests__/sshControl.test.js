const os = require('os')
const path = require('path')

const {
  controlName,
  controlPath,
  controlOptions,
  masterOptions,
  persist,
} = require('../sshControl')

const conn = (fields = {}) => ({
  is_over_ssh: true,
  ssh_user: 'root',
  ssh_server: '192.168.1.1',
  ssh_port: '22',
  ...fields,
})

// a connection is multiplexed through a unix socket, which is what windows does
// not have; the tests below are about the socket itself
const unix = process.platform !== 'win32'

describe('the connection two commands share', () => {
  test('is named after the machine and the account on it', () => {
    expect(controlName(conn())).toBe('root@192.168.1.1:22')
    expect(controlName(conn({ssh_port: undefined}))).toBe('root@192.168.1.1:22')
    expect(controlName(conn({ssh_port: '2000'}))).not.toBe(controlName(conn()))

    // the same account on the same machine reached another way is the same
    // connection, so it is the same socket
    expect(controlPath(conn({ssh_key: '/keys/other'}))).toBe(controlPath(conn()))
    expect(controlPath(conn({ssh_password: true}))).toBe(controlPath(conn()))
    expect(controlPath(conn({id: 'another', ssh_port: '2000'})))
      .not.toBe(controlPath(conn()))
  })

  test('is a socket ssh can create, wherever the app is running from', () => {
    if (!unix) {
      expect(controlPath(conn())).toBe(null)
      return
    }

    const socket = controlPath(conn())

    expect(socket.startsWith(os.tmpdir())).toBe(true)
    expect(socket).toMatch(/tinkr-ssh-[0-9a-f]{16}$/)
    expect(socket.length).toBeLessThanOrEqual(100)

    // the path is derived, not stored: every caller that derives it finds the
    // same socket without being told
    expect(controlPath(conn())).toBe(socket)
  })

  test('is a socket of this process, never one a process that is gone listens on', () => {
    if (!unix) {
      return
    }

    const socket = controlPath(conn())
    const pid = process.pid

    try {
      Object.defineProperty(process, 'pid', {value: pid + 1, configurable: true})

      // a master the next process cannot reach is one it cannot end either, and
      // one it binds over leaves the old master running with no socket at all
      expect(controlPath(conn())).not.toBe(socket)
    } finally {
      Object.defineProperty(process, 'pid', {value: pid, configurable: true})
    }

    expect(controlPath(conn())).toBe(socket)
  })

  test('goes somewhere short when the temporary directory is not', () => {
    if (!unix) {
      return
    }

    const temp = process.env.TMPDIR

    // where it goes when the temporary directory is short enough
    const socket = controlPath(conn())

    process.env.TMPDIR = path.join(os.tmpdir(), 'a'.repeat(120))

    try {
      // a socket path over `sun_path` is a socket ssh cannot create, so it is
      // not a path to try: the same socket, in a directory that fits
      expect(controlPath(conn())).toBe(path.join('/tmp', path.basename(socket)))
      expect(controlPath(conn())).toMatch(/^\/tmp\/tinkr-ssh-[0-9a-f]{16}$/)
    } finally {
      if (temp === undefined) {
        delete process.env.TMPDIR
      } else {
        process.env.TMPDIR = temp
      }
    }
  })

  test('is used by a command that did not start it, and started by one that did', () => {
    if (!unix) {
      expect(controlOptions(conn())).toEqual([])
      expect(masterOptions(conn())).toEqual([])
      return
    }

    const socket = controlPath(conn())

    // `auto` is what keeps this from being a requirement: a command finds the
    // master if it is there and becomes one if it is not, so a machine that
    // refuses multiplexing is a connection that is slow rather than one that
    // does not work
    expect(controlOptions(conn())).toEqual([
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${socket}`,
      '-o', `ControlPersist=${persist}`,
      // the handshake is bounded, so a host that is not reachable is ssh's own
      // words in seconds rather than a session that sits on a silent terminal
      '-o', 'ConnectTimeout=10',
    ])

    // the master the app starts is nobody's session, so nothing that ends takes
    // it with it, and it outlives the runs that travel down it
    const master = masterOptions(conn())

    expect(master).toContain('ControlMaster=yes')
    expect(master).toContain(`ControlPath=${socket}`)
    expect(master).toContain('ServerAliveInterval=30')
    expect(master).toContain('ServerAliveCountMax=3')

    // a login is waited on by every command that reaches the connection, so one
    // to a machine with no route to it is not waited on for minutes
    expect(master).toContain('ConnectTimeout=15')

    const held = Number(master.find(option => option.startsWith('ControlPersist=')).split('=')[1])

    expect(held).toBeGreaterThan(persist)
  })
})
