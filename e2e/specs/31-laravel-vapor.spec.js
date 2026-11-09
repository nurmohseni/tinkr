const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {chooseKind, chooseOutputView, openNewConnection, runCode, setEditorCode} = require('../support/actions')
const {startFakeVapor} = require('../support/fakeVapor')

const TOKEN = 'fixture-vapor-token'
const SAVED_TOKEN = '@laravel-vapor'

/**
 * The account the fake answers with: two teams, and two projects under the
 * first, so the three pickers of the dialog each have something to choose
 * between rather than something to confirm.
 *
 * The second environment's name is a branch with a slash in it, which is what a
 * Vapor environment is deployed from, and it is the name a command's path has to
 * carry as one segment (see the run below).
 */
const teams = [
  {
    id: 'team-main',
    name: 'Fixture Team',
    projects: [
      {
        id: 'proj-shop',
        name: 'Fixture Shop',
        environments: [
          {id: 'env-shop-production', name: 'production', vanityDomain: 'shop.test'},
          {id: 'env-shop-feature', name: 'feature/prices', vanityDomain: 'prices.test'},
        ],
      },
      {
        id: 'proj-blog',
        name: 'Fixture Blog',
        environments: [
          {id: 'env-blog-preview', name: 'preview', vanityDomain: 'blog.test'},
        ],
      },
    ],
  },
  {
    id: 'team-studio',
    name: 'Fixture Studio',
    projects: [],
  },
]

/** A connection on the fake's second environment, as the dialog would save it. */
const vaporConnection = (overrides = {}) => Object.assign({
  id: 'vapor',
  name: 'Fixture Shop · feature/prices',
  path: '',
  command: '',
  is_over_ssh: false,
  container_engine: '',
  container_name: '',
  container_path: '',
  tag: 'local',
  is_vapor: true,
  vapor_team_id: 'team-main',
  vapor_project_id: 'proj-shop',
  vapor_project_name: 'Fixture Shop',
  vapor_environment_id: 'env-shop-feature',
  vapor_environment_name: 'feature/prices',
}, overrides)

const appFile = (profile, name) => path.join(profile, 'Electron', 'app', name)

const readSecrets = profile => {
  try {
    return JSON.parse(fs.readFileSync(appFile(profile, 'secrets.json'), 'utf8'))
  } catch (e) {
    return {}
  }
}

const openSettings = async (app, page) => {
  const [settings] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', {name: 'Settings'}).click(),
  ])

  await settings.locator('.app').waitFor({state: 'visible'})
  await expect(settings.locator('aside.rail')).toBeVisible()
  await settings.bringToFront()

  return settings
}

/**
 * A Vapor environment reports no php version, which the app reads as unknown
 * rather than missing: the warning a connection without php gets must never
 * stand over the code of one that runs through an API.
 *
 * @param {import('playwright').Page} page
 */
const expectNoPhpWarning = async page => {
  await expect(page.locator('.pane-warning')).toHaveCount(0)
}

test.describe('Laravel Vapor', () => {
  test('checks a token against the API, keeps it, and forgets it', async () => {
    const vapor = await startFakeVapor({teams})
    // the account's home is the test's own: the Vapor CLI keeps a login there,
    // and one on the machine running the suite would put its row on screen
    const {app, page, profile, close} = await launchTinkr(
      {home: true},
      {env: {TINKR_LARAVEL_VAPOR_URL: vapor.url}},
    )

    try {
      const settings = await openSettings(app, page)

      await settings.locator('aside.rail').getByRole('button', {name: 'Laravel Vapor'}).click()

      const token = settings.getByLabel('API token')

      // a token the API refuses is a message, and it is not written anywhere
      await token.fill('not-a-token')
      await settings.getByRole('button', {name: 'Check and save'}).click()

      await expect(settings.getByRole('status'))
        .toContainText('The Laravel Vapor API token is invalid or has expired.')
      await expect(token).toBeVisible()
      expect(readSecrets(profile)[SAVED_TOKEN]).toBeUndefined()

      // the same field, a token that answers: what it reached is the result, and
      // the token itself is not given back to be read
      await token.fill(TOKEN)
      await settings.getByRole('button', {name: 'Check and save'}).click()

      await expect(settings.getByRole('status')).toContainText('Token saved. It reached 2 teams.')
      await expect(token).toHaveCount(0)
      await expect(settings.getByText('A token is kept on this machine.')).toBeVisible()
      expect(readSecrets(profile)[SAVED_TOKEN]).toBe(TOKEN)

      // forget is one press, and the field is back for a paste
      await settings.getByRole('button', {name: 'Forget', exact: true}).click()

      await expect(settings.getByLabel('API token')).toBeVisible()
      await expect.poll(() => readSecrets(profile)[SAVED_TOKEN]).toBeUndefined()
    } finally {
      await vapor.close()
      await close()
    }
  })

  test('creates a connection from a team, a project and an environment and connects to it', async () => {
    const vapor = await startFakeVapor({teams})
    const {page, profile, errors, close} = await launchTinkr(
      {home: true, secrets: {[SAVED_TOKEN]: TOKEN}},
      {env: {TINKR_LARAVEL_VAPOR_URL: vapor.url}},
    )

    try {
      await openNewConnection(page)

      const dialog = page.getByRole('dialog')

      await chooseKind(page, 'vapor')

      // the team, then the project under it, then the environment a run is sent
      // to: each is the one the picker was given, so a stale list would show
      await dialog.locator('#connection-vapor-team').selectOption({label: 'Fixture Team'})
      await dialog.locator('#connection-vapor-project').selectOption({label: 'Fixture Shop'})

      const environment = dialog.locator('#connection-vapor-environment')

      await expect(environment).toBeVisible()
      await expect(environment.locator('option')).toHaveCount(3)
      // the environment's own name and the address it answers from: a name alone
      // does not say where the code is about to be
      await environment.selectOption({label: 'production · shop.test'})

      // the route and the name are the project and the environment read as one,
      // and Connect is only a press once there is somewhere to send code
      await expect(dialog.getByRole('list', {name: 'Route'})).toContainText('Fixture Shop')
      await expect(dialog.locator('#connection-name')).toHaveValue('Fixture Shop · production')

      await dialog.getByRole('button', {name: 'Connect'}).click()

      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.statusbar')).toContainText('Connected · Fixture Shop · production (Laravel Vapor)')
      await expect(page.locator('.titlebar__center')).toContainText('Laravel Vapor')
      // a Vapor environment reports no PHP version, so the bar shows none rather
      // than the last one it was told
      await expect(page.locator('.statusbar')).not.toContainText('PHP ')

      // the terminal says what the connection is, since there is no shell to
      // greet: the project and the environment the next run goes to
      await chooseOutputView(page, 'Terminal')
      await expect(page.locator('.xterm').first()).toContainText('Laravel Vapor · Fixture Shop / production')

      // what was stored is the route, not a command: the app builds one per run
      const stored = JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8'))
      const saved = Object.values(stored).find(connection => connection.is_vapor)

      expect(saved).toMatchObject({
        is_vapor: true,
        name: 'Fixture Shop · production',
        command: '',
        vapor_team_id: 'team-main',
        vapor_project_id: 'proj-shop',
        vapor_project_name: 'Fixture Shop',
        vapor_environment_id: 'env-shop-production',
        vapor_environment_name: 'production',
      })

      expect(errors).toEqual([])
    } finally {
      await vapor.close()
      await close()
    }
  })

  test('runs a snippet in the environment and reads what it printed and returned', async () => {
    const vapor = await startFakeVapor({teams})
    const {page, close} = await launchTinkr(
      {home: true, connections: [vaporConnection()], secrets: {[SAVED_TOKEN]: TOKEN}},
      {env: {TINKR_LARAVEL_VAPOR_URL: vapor.url}},
    )

    try {
      await expectNoPhpWarning(page)

      // the fake starts the command in the fixture project, so this run is a
      // real php process: the snippet prints, and Laravel's `collect` of the
      // fixture answers its sum
      await runCode(page, "echo 'fixture printed';\ncollect([1, 2, 3])->sum();")

      await expect(page.locator('.output .printed')).toContainText('fixture printed')
      await expect(page.locator('.output .t-number').filter({hasText: '6'})).toHaveCount(1)
      await expect(page.locator('.statusbar')).not.toContainText('Run failed')

      // one run is one command, and it is the documented one: tinker with the
      // wrapped code, base64 so no snippet can break the shell's quoting. The
      // environment is named rather than numbered in the path, so a branch with
      // a slash in it is one segment of it
      const created = vapor.requests.filter(request =>
        request.method === 'POST' &&
        request.path === '/api/projects/proj-shop/environments/feature%2Fprices/commands')

      expect(created).toHaveLength(1)
      expect(created[0].authorization).toBe(`Bearer ${TOKEN}`)
      expect(created[0].body.command).toMatch(/^tinker --execute='eval\(base64_decode\("/)
      expect(vapor.commands).toHaveLength(1)
      expect(vapor.commands[0].status).toBe('finished')
      expect(vapor.commands[0].status_code).toBe(0)
    } finally {
      await vapor.close()
      await close()
    }
  })

  test('says the command may have been started when the API breaks on the request', async () => {
    const vapor = await startFakeVapor({
      teams,
      fail: {status: 500, path: /\/commands$/},
    })
    const {page, close} = await launchTinkr(
      {home: true, connections: [vaporConnection()], secrets: {[SAVED_TOKEN]: TOKEN}},
      {env: {TINKR_LARAVEL_VAPOR_URL: vapor.url}},
    )

    try {
      await expectNoPhpWarning(page)

      await runCode(page, '1 + 1;')

      // a 500 is the API not answering, and a request that arrived may have
      // started a command: running the snippet again could run it twice
      await expect(page.locator('.error-surface__class')).toHaveText('VaporError')
      await expect(page.locator('.error-surface__message'))
        .toContainText('The server could not handle this request.')
      await expect(page.locator('.error-surface__message'))
        .toContainText('Laravel Vapor may have started it: check the environment\'s commands before running it again.')
      await expect(page.locator('.statusbar')).toContainText('Run failed · VaporError')
    } finally {
      await vapor.close()
      await close()
    }
  })

  test('stops waiting for a command, and says the command keeps running', async () => {
    const vapor = await startFakeVapor({teams})
    const {page, close} = await launchTinkr(
      {home: true, connections: [vaporConnection()], secrets: {[SAVED_TOKEN]: TOKEN}},
      {env: {TINKR_LARAVEL_VAPOR_URL: vapor.url}},
    )

    try {
      const button = page.locator('.tabbar .btn--run').first()

      await expectNoPhpWarning(page)

      await setEditorCode(page, 'sleep(5);')
      await button.click()
      await expect(button).toHaveClass(/btn--danger/, {timeout: 10_000})

      // the command is created and being followed: the poll is what says the
      // run has an id to name in its own answer
      await expect.poll(
        () => vapor.requests.filter(request => request.method === 'GET' && request.path.startsWith('/api/commands/')).length,
      ).toBeGreaterThan(0)

      await button.click()

      await expect(page.locator('.error-surface__message')).toContainText('The run was stopped.')
      await expect(page.locator('.error-surface__message'))
        .toContainText(`Laravel Vapor keeps running command ${vapor.commands[0].id} until it ends.`)
      await expect(button).not.toHaveClass(/btn--danger/)
    } finally {
      await vapor.close()
      await close()
    }
  })
})
