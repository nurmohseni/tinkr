const fs = require('fs')
const os = require('os')
const path = require('path')
const {execFileSync} = require('child_process')
const {_electron: electron} = require('playwright')

const repo = path.resolve(__dirname, '../..')
const fixture = path.join(repo, 'e2e', 'fixtures', 'app')
const mainEntry = path.join(repo, 'packages', 'tinkr-main', 'src', 'index.js')
const WEB_PORT = process.env.TINKR_E2E_WEB_PORT || '8123'

// Electron in development takes its name from the electron package, not from
// this repo's manifest, so its userData is `$XDG_CONFIG_HOME/Electron`. Every
// test gets a profile of its own there: the stores, the history, the snippets
// and the secret file are all under it, and none of the person's own data is.
const profileApp = profile => path.join(profile, 'Electron', 'app')

const defaults = {
  locale: 'en',
  command_default: 'php artisan tinker',
  form_switch: true,
  form_prefix: 'field_',
  confirm_close_session: true,
  theme: 'dark',
  editor_layout: 'side',
  result_blocks: 'all',
  run_timeout: 60000,
  shortcut_run: ['Control', 'r'],
  shortcut_new_connection: ['Meta', 'Shift', 'N'],
  shortcut_ai: ['Control', 'Shift', 'L'],
  ai_provider: 'openai',
  ai_endpoint: '',
  ai_token: '',
  ai_model: '',
  // a suggestion asked for on every pause would have the fixture answering
  // calls no test is about
  ai_autocomplete: false,
  ai_delay: 50,
  mcp_connection: '',
  log_dir: 'storage/logs',
}

const fixtureConnection = (overrides = {}) => Object.assign({
  id: 'fixture',
  name: 'Fixture',
  path: fixture,
  command: 'php artisan tinker',
  is_over_ssh: false,
  container_engine: '',
  container_name: '',
  container_path: '',
  tag: 'local',
}, overrides)

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

/**
 * Put a profile on disk before the app reads it.
 *
 * @param {Object} [seed]
 * @param {Array<Object>|null} [seed.connections] `null` leaves the store to its
 *   own default, which is the quick connection alone
 * @param {Object} [seed.config]
 * @param {Object} [seed.snippets] snippetId => snippet
 * @param {Object} [seed.history] connectionId => entries
 * @param {Object} [seed.secrets] connectionId => password
 * @return {String} the profile directory
 */
const seedProfile = ({connections, config = {}, snippets = {}, history = {}, secrets, dirs = [], home = false} = {}) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-e2e-'))
  const app = profileApp(profile)

  fs.mkdirSync(app, {recursive: true})

  // a test that asks a client where its configuration goes asks the account's
  // home, so it is given one of its own rather than the person's
  if (home) {
    fs.mkdirSync(path.join(profile, 'home'), {recursive: true, mode: 0o700})
  }
  // a client's own data directory, where the app looks for an installation
  dirs.forEach(dir => fs.mkdirSync(path.join(profile, dir), {recursive: true}))
  writeJson(path.join(app, 'config.json'), Object.assign({}, defaults, config))

  if (connections !== null) {
    const list = connections || [fixtureConnection()]

    writeJson(path.join(app, 'connections.json'), Object.fromEntries(
      list.map(connection => [connection.id, connection])
    ))
  }

  // the store's file is named for the connection and holds its snippets by id
  Object.entries(snippets).forEach(([connectionId, map]) => {
    writeJson(path.join(app, 'snippets', `${connectionId}.json`), map)
  })

  Object.entries(history).forEach(([id, entries]) => {
    fs.mkdirSync(path.join(app, 'history'), {recursive: true})
    fs.writeFileSync(path.join(app, 'history', `${id}.json`), JSON.stringify({entries}))
  })

  if (secrets) {
    fs.writeFileSync(path.join(app, 'secrets.json'), JSON.stringify(secrets, null, 2))
  }

  return profile
}

/**
 * Start the real app: real main process, real preload bridge, real renderer
 * from the Vite server the config runs.
 *
 * @param {Object} [seed] see seedProfile
 * @param {Object} [options]
 * @param {Number} [options.timeout]
 * @param {Boolean} [options.keepProfile]
 * @return {Promise<{app: import('playwright').ElectronApplication,
 *   page: import('playwright').Page, profile: String, errors: Array,
 *   close: Function}>}
 */
const launchTinkr = async (seed = {}, {timeout = 60_000, keepProfile = false, profile: existing = null, env = {}} = {}) => {
  const profile = existing || seedProfile(seed)
  const owned = !existing
  const errors = []
  const home = seed && seed.home ? path.join(profile, 'home') : null

  const app = await electron.launch({
    // the suite runs on a display with no GPU of its own, and a renderer that
    // loses its gpu process comes up as an empty page: the test window is drawn
    // in software, and its shared memory is the runner's small one
    args: [mainEntry, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    cwd: repo,
    env: Object.assign({}, process.env, {
      WEB_PORT,
      XDG_CONFIG_HOME: profile,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      TINKR_E2E: '1',
      ...(home ? {HOME: home} : {}),
    }, env),
    timeout,
  })

  app.process().stderr?.on('data', data => {
    const line = String(data)

    // the preload's own console errors are how a page that never ran shows up,
    // and the app turns them into a log line rather than a dialog
    if (/\[renderer\].*error/i.test(line)) {
      errors.push(line.trim())
    }
  })

  // the child process is what a close that hangs is ended with, and it is
  // captured while the application still has it
  const child = app.process()

  const page = await app.firstWindow({timeout})
  page.setDefaultTimeout(20_000)

  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    // React reports its own deprecations through console.error; they are not
    // the page failing, and a test that trips on them would be about React
    if (message.type() === 'error' && !message.text().startsWith('Warning:')) {
      errors.push(`console: ${message.text()}`)
    }
  })

  const close = async () => {
    const closing = app.close().catch(() => {})

    // a window the app keeps open must not become the whole suite's timeout: a
    // graceful close is given its moment, and the process is then taken down
    await Promise.race([
      closing,
      new Promise(resolve => setTimeout(resolve, 8_000)),
    ])

    if (child && child.exitCode === null && !child.killed) {
      child.kill('SIGKILL')
    }

    // a child that has been signalled but not reaped is a handle the worker
    // teardown waits on; the app has a moment to go
    if (child && child.exitCode === null) {
      await new Promise(resolve => {
        child.once('exit', resolve)
        setTimeout(resolve, 2000).unref()
      })
    }

    // an Electron that was taken down hard can leave its gpu and network
    // processes behind; they carry the profile on their command line, so the
    // profile is what finds them
    if (process.platform === 'linux') {
      try {
        execFileSync('pkill', ['-9', '-f', `--user-data-dir=${profile}`], {stdio: 'ignore'})
      } catch (error) {
        // none left to take down is the answer we wanted
      }
    }

    if (owned && !keepProfile) {
      fs.rmSync(profile, {recursive: true, force: true})
    }
  }

  const boot = async () => {
    await page.locator('.app').waitFor({state: 'visible', timeout: 45_000})
    await page.locator('.statusbar').waitFor({state: 'visible'})
    // the window is on its connection as soon as the main process has made it
    await page.locator('.statusbar').getByText(/Connected · /).waitFor({state: 'visible'})

    // the php question is put to a session of its own and answered in a few
    // seconds; acting before it lands is acting while the app is still booting
    await page.locator('.statusbar').getByText(/^PHP \d/).waitFor({state: 'visible', timeout: 15_000}).catch(() => {})
  }

  const failed = async error => {
    // a launch that failed before returning would otherwise leave its Electron
    // process and its profile behind for every retry, and the window's own
    // state is what says why it never came up
    const state = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      text: (document.body && document.body.innerText || '').slice(0, 400),
      html: (document.body && document.body.innerHTML || '').slice(0, 600),
    })).catch(inner => ({error: inner.message}))

    let log = ''

    try {
      log = fs.readFileSync(path.join(profile, 'Electron', 'logs', 'main.log'), 'utf8').slice(-4000)
    } catch (inner) {
      log = `(no log: ${inner.message})`
    }

    console.error('[e2e] the app did not come up:', JSON.stringify(state), errors, log)

    await close()

    throw error
  }

  try {
    await boot()
  } catch (e) {
    // a network interface changing under Chromium aborts every module request
    // (`ERR_NETWORK_CHANGED`), and the page that was loading stays empty. The
    // interface has settled by the time the first attempt has waited, so the
    // page is loaded again rather than a second app being started.
    if (!errors.some(message => message.includes('ERR_NETWORK_CHANGED'))) {
      await failed(e)
    }

    errors.length = 0
    await page.reload({waitUntil: 'domcontentloaded'}).catch(() => {})

    try {
      await boot()
    } catch (again) {
      await failed(again)
    }
  }

  return {app, page, profile, errors, close, fixture}
}

module.exports = {
  defaults,
  fixture,
  fixtureConnection,
  launchTinkr,
  profileApp,
  repo,
  seedProfile,
  writeJson,
}

/**
 * A throwaway copy of the fixture project, for a flow that writes to it.
 *
 * @return {String}
 */
const copyFixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-e2e-app-'))

  fs.cpSync(fixture, dir, {recursive: true})

  return dir
}

module.exports.copyFixture = copyFixture
