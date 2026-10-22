const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const {spawn, execFileSync} = require('child_process')
const {test, expect} = require('@playwright/test')

const {fixture, fixtureConnection, launchTinkr} = require('../support/tinkr')
const {chooseKind, editConnection, runCode} = require('../support/actions')

const run = (command, args) => execFileSync(command, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
/** The log viewer window for the connection the editor is on. */
const openLogs = async (app, page) => {
  const [logs] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', {name: 'Logs'}).click(),
  ])

  await logs.locator('.logs').waitFor({state: 'visible'})

  return logs
}


const works = (command, args) => {
  try {
    run(command, args)

    return true
  } catch (e) {
    return false
  }
}

// ---------------------------------------------------------------- container

const docker = works('docker', ['ps'])
const image = process.env.TINKR_E2E_CONTAINER_IMAGE ||
  ['php:8.4-cli', 'sail-8.5/app:latest'].find(candidate => works('docker', ['image', 'inspect', candidate]))

let container = null

test.beforeAll(async () => {
  if (!docker || !image) {
    return
  }

  container = `tinkr-e2e-${process.pid}-${Date.now()}`

  try {
    run('docker', [
      'run', '-d', '--name', container,
      '--entrypoint', 'sleep',
      '-v', `${fixture}:/app`,
      '-w', '/app',
      image,
      '600',
    ])

    // the engine brings an interface up, and Chromium aborts what was in flight
    // when the network under it changes: let the change settle before an app is
    // launched onto it
    await new Promise(resolve => setTimeout(resolve, 2000))
  } catch (e) {
    container = null
  }
})

test.afterAll(async () => {
  if (container) {
    try {
      run('docker', ['rm', '-f', container])
    } catch (e) {
      // a container that went away on its own is one there is nothing to clean
    }
  }
})

test.describe('a project in a container', () => {
  test('offers what the engine runs, and runs a snippet inside it', async () => {
    test.skip(!container, 'docker or a php image is not available')

    const {app, page, close} = await launchTinkr()

    try {
      await page.getByRole('navigation', {name: 'Connections'})
        .getByRole('button', {name: 'New Connection'})
        .click()

      const dialog = page.getByRole('dialog')

      await chooseKind(page, 'container')
      await dialog.locator('#connection-container-name').fill(container)

      // the picker is filled from what docker is running now
      await expect(dialog.locator(`#connection-container-names option[value="${container}"]`))
        .toHaveCount(1, {timeout: 30_000})

      await dialog.locator('#connection-container-path').fill('/app')
      await dialog.locator('#connection-name').fill('In container')
      // the host keeps the project; the container has it at /app
      await dialog.locator('#connection-path').fill(fixture)

      await expect(dialog.locator('#connection-command')).not.toBeVisible()

      await dialog.getByRole('button', {name: 'Connect'}).click()

      await expect(page.locator('.statusbar')).toContainText('Connected · In container (container)')
      await expect(page.locator('.statusbar').getByText(/PHP \d/)).toBeVisible({timeout: 20_000})

      await runCode(page, '1 + 1;')

      await expect(page.locator('.output .t-number').first()).toHaveText('2')

      // the log files are the container's: the read is a command in there
      const logs = await openLogs(app, page)

      await logs.getByTitle('laravel.log').click()
      await expect(logs.locator('.logs__body')).toContainText('fixture booted')
      await expect(logs.locator('.logs__body')).toContainText('slow query detected')
    } finally {
      await close()
    }
  })
})

// ---------------------------------------------------------------- ssh

const sshdBin = (() => {
  try {
    return run('which', ['sshd']).trim()
  } catch (e) {
    return null
  }
})()

const hasSshTools = works('which', ['ssh-keygen']) && works('which', ['ssh-keyscan'])
const wantsLocalSsh = process.env.TINKR_E2E_LOCAL_SSH === '1' && process.platform !== 'win32' &&
  Boolean(sshdBin) && hasSshTools
let sshd = null

const findPort = () => new Promise((resolve, reject) => {
  const probe = net.createServer()

  probe.unref()
  probe.on('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const {port} = probe.address()

    probe.close(() => resolve(port))
  })
})

const waitForPort = async (port, tries = 40) => {
  for (let at = 0; at < tries; at++) {
    const open = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1')

      socket.on('connect', () => {
        socket.end()
        resolve(true)
      })
      socket.on('error', () => resolve(false))
    })

    if (open) {
      return true
    }

    await new Promise(resolve => setTimeout(resolve, 200))
  }

  return false
}

test.beforeAll(async () => {
  if (!wantsLocalSsh) {
    return
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-sshd-'))
  const port = await findPort()

  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(dir, 'host_key')])
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(dir, 'client_key')])
  fs.copyFileSync(path.join(dir, 'client_key.pub'), path.join(dir, 'authorized_keys'))

  fs.writeFileSync(path.join(dir, 'sshd_config'), [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${path.join(dir, 'host_key')}`,
    `AuthorizedKeysFile ${path.join(dir, 'authorized_keys')}`,
    'PasswordAuthentication no',
    'PubkeyAuthentication yes',
    'UsePAM no',
    'StrictModes no',
    `PidFile ${path.join(dir, 'sshd.pid')}`,
    'LogLevel ERROR',
    '',
  ].join('\n'))

  const child = spawn(sshdBin, ['-f', path.join(dir, 'sshd_config'), '-D', '-e'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  if (!await waitForPort(port)) {
    child.kill()

    return
  }

  // ssh reads known_hosts from the account's own home, not from HOME, so the
  // suite puts the key it just made there for the length of the run and puts
  // back what it found
  const known = path.join(os.homedir(), '.ssh', 'known_hosts')
  const before = fs.existsSync(known) ? fs.readFileSync(known, 'utf8') : null

  fs.mkdirSync(path.dirname(known), {recursive: true, mode: 0o700})
  fs.appendFileSync(known, run('ssh-keyscan', ['-p', String(port), '127.0.0.1']))

  const connection = {
    id: 'ssh',
    name: 'Over ssh',
    path: fixture,
    command: 'php artisan tinker',
    is_over_ssh: true,
    ssh_server: '127.0.0.1',
    ssh_port: String(port),
    ssh_user: os.userInfo().username,
    ssh_key: path.join(dir, 'client_key'),
    ssh_password: false,
    tag: 'local',
  }

  sshd = {
    child,
    dir,
    connection,
    restore: () => {
      if (before === null) {
        fs.rmSync(known, {force: true})
      } else {
        fs.writeFileSync(known, before)
      }
    },
  }
})

test.afterAll(async () => {
  if (sshd) {
    const {child} = sshd

    // a server that is still running keeps the worker's pipe open: wait for it
    // to go, and take it down if it does not
    await new Promise(resolve => {
      if (child.exitCode !== null) {
        resolve()

        return
      }

      child.once('exit', resolve)
      child.kill('SIGTERM')

      setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 3000).unref()
    })

    sshd.restore()
    fs.rmSync(sshd.dir, {recursive: true, force: true})
    sshd = null
  }
})

test.describe('a project on a server over ssh', () => {
  test('boots a session through a real sshd and runs a snippet there', async () => {
    test.skip(!sshd, 'set TINKR_E2E_LOCAL_SSH=1 to start a local sshd for this test')

    const {app, page, close} = await launchTinkr({connections: [sshd.connection]})

    try {
      await expect(page.locator('.statusbar')).toContainText('Connected · Over ssh (ssh)')
      await expect(page.locator('.statusbar').getByText(/PHP \d/)).toBeVisible({timeout: 30_000})

      await runCode(page, '2 * 21;')

      await expect(page.locator('.output .t-number').first()).toHaveText('42')

      // a class a snippet names without its namespace is aliased into the
      // session, and the index that names it is the project's own: over ssh,
      // the one read on the machine that holds the project
      await runCode(page, 'Order::count();')

      await expect(page.locator('.output .t-number').first()).toHaveText('3')

      // the connection's own settings are what the store holds, key and port
      // included
      await editConnection(page, 'Over ssh')

      const dialog = page.getByRole('dialog')

      await expect(dialog.locator('#connection-ssh-port')).toHaveValue(sshd.connection.ssh_port)
      await expect(dialog.locator('#connection-ssh-key')).toContainText(path.basename(sshd.connection.ssh_key))
      await page.keyboard.press('Escape')

      // the logs are read on the far side, by the php the session runs there
      const logs = await openLogs(app, page)

      await logs.getByTitle('laravel.log').click()
      await expect(logs.locator('.logs__body')).toContainText('fixture booted')
      await expect(logs.locator('.logs__body')).toContainText('fixture failure')
    } finally {
      await close()
    }
  })
})
