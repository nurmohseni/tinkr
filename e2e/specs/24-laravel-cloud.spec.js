const fs = require('fs')
const path = require('path')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {chooseKind, chooseOutputView, openNewConnection, runCode, setEditorCode} = require('../support/actions')
const {startFakeCloud} = require('../support/fakeCloud')

const TOKEN = 'fixture-cloud-token'
const SAVED_TOKEN = '@laravel-cloud'

/**
 * The account the fake answers with: two applications, one per page, so the
 * picker's pagination is what puts the second one there.
 */
const applications = [
  {
    id: 'app-shop',
    name: 'Fixture Shop',
    slug: 'fixture-shop',
    region: 'eu-west-1',
    environments: [
      {id: 'env-shop-production', name: 'production', slug: 'production', status: 'running', phpVersion: '8.4', domain: 'shop.test'},
    ],
  },
  {
    id: 'app-blog',
    name: 'Fixture Blog',
    slug: 'fixture-blog',
    region: 'eu-west-1',
    environments: [
      {id: 'env-blog-preview', name: 'preview', slug: 'preview', status: 'hibernating', phpVersion: '8.3', domain: 'blog.test'},
    ],
  },
]

/** A connection on the fake's second application, as the dialog would save it. */
const cloudConnection = (overrides = {}) => Object.assign({
  id: 'cloud',
  name: 'Fixture Blog · preview',
  path: '',
  command: '',
  is_over_ssh: false,
  container_engine: '',
  container_name: '',
  container_path: '',
  tag: 'local',
  is_cloud: true,
  cloud_application_id: 'app-blog',
  cloud_application_name: 'Fixture Blog',
  cloud_environment_id: 'env-blog-preview',
  cloud_environment_name: 'preview',
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

test.describe('Laravel Cloud', () => {
  test('checks a token against the API, keeps it, and forgets it', async () => {
    const cloud = await startFakeCloud({applications})
    const {app, page, profile, close} = await launchTinkr({}, {env: {TINKR_LARAVEL_CLOUD_URL: cloud.url}})

    try {
      const settings = await openSettings(app, page)

      await settings.locator('aside.rail').getByRole('button', {name: 'Laravel Cloud'}).click()

      const token = settings.getByLabel('API token')

      // a token the API refuses is a message, and it is not written anywhere
      await token.fill('not-a-token')
      await settings.getByRole('button', {name: 'Check and save'}).click()

      await expect(settings.getByRole('status'))
        .toContainText('The Laravel Cloud API token is invalid or has expired.')
      await expect(token).toBeVisible()
      expect(readSecrets(profile)[SAVED_TOKEN]).toBeUndefined()

      // the same field, a token that answers: what it reached is the result
      await token.fill(TOKEN)
      await settings.getByRole('button', {name: 'Check and save'}).click()

      await expect(settings.getByRole('status')).toContainText('Token saved. It reached 2 applications.')
      await expect(token).toHaveCount(0)
      await expect(settings.getByText('A token is kept on this machine.')).toBeVisible()
      expect(readSecrets(profile)[SAVED_TOKEN]).toBe(TOKEN)

      // forget is one press, and the field is back for a paste
      await settings.getByRole('button', {name: 'Forget', exact: true}).click()

      await expect(settings.getByLabel('API token')).toBeVisible()
      await expect.poll(() => readSecrets(profile)[SAVED_TOKEN]).toBeUndefined()
    } finally {
      await cloud.close()
      await close()
    }
  })

  test('creates a connection from an application and its environment and connects to it', async () => {
    const cloud = await startFakeCloud({applications})
    const {page, profile, errors, close} = await launchTinkr(
      {secrets: {[SAVED_TOKEN]: TOKEN}},
      {env: {TINKR_LARAVEL_CLOUD_URL: cloud.url}},
    )

    try {
      await openNewConnection(page)

      const dialog = page.getByRole('dialog')

      await chooseKind(page, 'cloud')

      // the second application is on the API's second page, which the picker
      // reaches by following `links.next`
      await dialog.locator('#connection-cloud-application').selectOption({label: 'Fixture Blog'})

      const environment = dialog.locator('#connection-cloud-environment')

      await expect(environment).toBeVisible()
      await expect(environment.locator('option')).toHaveCount(2)
      await environment.selectOption({label: 'preview · hibernating · PHP 8.3'})

      // the route and the name are the application and the environment read as
      // one, and Connect is only a press once there is somewhere to send code
      await expect(dialog.getByRole('list', {name: 'Route'})).toContainText('Fixture Blog')
      await expect(dialog.locator('#connection-name')).toHaveValue('Fixture Blog · preview')

      await dialog.getByRole('button', {name: 'Connect'}).click()

      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.statusbar')).toContainText('Connected · Fixture Blog · preview (Laravel Cloud)')
      await expect(page.locator('.titlebar__center')).toContainText('Laravel Cloud')
      await expect(page.locator('.statusbar').getByText('PHP 8.3', {exact: true})).toBeVisible()

      // the terminal says what the connection is, since there is no shell to
      // greet: the application, the environment and what the environment does
      await chooseOutputView(page, 'Terminal')
      await expect(page.locator('.xterm').first()).toContainText('Laravel Cloud · Fixture Blog / preview (hibernating)')

      // what was stored is the route, not a command: the app builds one per run
      const stored = JSON.parse(fs.readFileSync(appFile(profile, 'connections.json'), 'utf8'))
      const saved = Object.values(stored).find(connection => connection.is_cloud)

      expect(saved).toMatchObject({
        is_cloud: true,
        name: 'Fixture Blog · preview',
        command: '',
        cloud_application_id: 'app-blog',
        cloud_application_name: 'Fixture Blog',
        cloud_environment_id: 'env-blog-preview',
        cloud_environment_name: 'preview',
      })

      expect(errors).toEqual([])
    } finally {
      await cloud.close()
      await close()
    }
  })

  test('runs a snippet in the environment and reads what it printed and returned', async () => {
    const cloud = await startFakeCloud({applications})
    const {page, close} = await launchTinkr(
      {connections: [cloudConnection()], secrets: {[SAVED_TOKEN]: TOKEN}},
      {env: {TINKR_LARAVEL_CLOUD_URL: cloud.url}},
    )

    try {
      // the fake starts the command in the fixture project, so this run is a
      // real php process: the snippet prints, and Laravel's `collect` of the
      // fixture answers its sum
      await runCode(page, "echo 'fixture printed';\ncollect([1, 2, 3])->sum();")

      await expect(page.locator('.output .printed')).toContainText('fixture printed')
      await expect(page.locator('.output .t-number').filter({hasText: '6'})).toHaveCount(1)
      await expect(page.locator('.statusbar')).not.toContainText('Run failed')

      // one run is one command, and it is the documented one: tinker with the
      // wrapped code, base64 so no snippet can break the shell's quoting
      const created = cloud.requests.filter(request =>
        request.method === 'POST' && request.path === '/environments/env-blog-preview/commands')

      expect(created).toHaveLength(1)
      expect(created[0].authorization).toBe(`Bearer ${TOKEN}`)
      expect(created[0].body.command).toMatch(/^php artisan tinker --execute='eval\(base64_decode\("/)
      expect(cloud.commands).toHaveLength(1)
      expect(cloud.commands[0].status).toBe('command.success')
    } finally {
      await cloud.close()
      await close()
    }
  })

  test('names the permission a token is missing when the API refuses a command', async () => {
    const cloud = await startFakeCloud({
      applications,
      fail: {status: 403, path: /\/commands/},
    })
    const {page, close} = await launchTinkr(
      {connections: [cloudConnection()], secrets: {[SAVED_TOKEN]: TOKEN}},
      {env: {TINKR_LARAVEL_CLOUD_URL: cloud.url}},
    )

    try {
      await runCode(page, '1 + 1;')

      await expect(page.locator('.error-surface__class')).toHaveText('CloudError')
      await expect(page.locator('.error-surface__message'))
        .toContainText('The Laravel Cloud API token is missing the "Environments: Create environment commands" permission.')
      await expect(page.locator('.statusbar')).toContainText('Run failed · CloudError')
    } finally {
      await cloud.close()
      await close()
    }
  })

  test('stops waiting for a command, and says the command keeps running', async () => {
    const cloud = await startFakeCloud({applications})
    const {page, close} = await launchTinkr(
      {connections: [cloudConnection()], secrets: {[SAVED_TOKEN]: TOKEN}},
      {env: {TINKR_LARAVEL_CLOUD_URL: cloud.url}},
    )

    try {
      const button = page.locator('.tabbar .btn--run').first()

      await setEditorCode(page, 'sleep(5);')
      await button.click()
      await expect(button).toHaveClass(/btn--danger/, {timeout: 10_000})

      // the command is created and being followed: the poll is what says the
      // run has an id to name in its own answer
      await expect.poll(
        () => cloud.requests.filter(request => request.method === 'GET' && request.path.startsWith('/commands/')).length,
      ).toBeGreaterThan(0)

      await button.click()

      await expect(page.locator('.error-surface__message')).toContainText('The run was stopped.')
      await expect(page.locator('.error-surface__message'))
        .toContainText(`Laravel Cloud keeps running command ${cloud.commands[0].id} until it ends.`)
      await expect(button).not.toHaveClass(/btn--danger/)
    } finally {
      await cloud.close()
      await close()
    }
  })

  test('sends a cloud connection to the settings when no token is saved', async () => {
    const cloud = await startFakeCloud({applications})
    const {app, page, close} = await launchTinkr({}, {env: {TINKR_LARAVEL_CLOUD_URL: cloud.url}})

    try {
      await openNewConnection(page)

      const dialog = page.getByRole('dialog')

      await chooseKind(page, 'cloud')

      await expect(dialog).toContainText('No Laravel Cloud token yet. Add one in the settings, then come back here.')
      // nothing is picked and nothing can be connected: there is no account
      await expect(dialog.locator('#connection-cloud-application')).toHaveCount(0)
      await expect(dialog.getByRole('button', {name: 'Connect'})).toBeDisabled()
      // the account was never asked, because there is no token to ask with
      expect(cloud.requests.filter(request => request.path === '/applications')).toHaveLength(0)

      const [settings] = await Promise.all([
        app.waitForEvent('window'),
        dialog.getByRole('button', {name: 'Open the Laravel Cloud settings'}).click(),
      ])

      await settings.locator('.app').waitFor({state: 'visible'})
      await settings.locator('aside.rail').getByRole('button', {name: 'Laravel Cloud'}).click()

      await expect(settings.getByLabel('API token')).toBeVisible()
    } finally {
      await cloud.close()
      await close()
    }
  })
})
