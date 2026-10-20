const http = require('http')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {chooseOutputView, runCode} = require('../support/actions')

/** An OpenAI-shaped provider that answers every test the same way. */
const startProvider = async () => {
  const seen = []

  const server = http.createServer((request, response) => {
    let body = ''

    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      let parsed = {}

      try {
        parsed = JSON.parse(body)
      } catch (e) {
        parsed = {}
      }

      seen.push({url: request.url, body: parsed})

      const system = (parsed.messages || []).find(message => message.role === 'system')
      const check = system && system.content === 'Answer with the single word: ok'

      response.writeHead(200, {'content-type': 'application/json'})
      response.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: check ? 'ok' : 'Here it is.\n```php\n1 + 1;\n```',
          },
        }],
      }))
    })
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  return {
    server,
    seen,
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

const aiConfig = endpoint => ({
  ai_provider: 'openai',
  ai_endpoint: endpoint,
  ai_token: 'fixture-token',
  ai_model: 'fixture-model',
  ai_autocomplete: false,
})

test.describe('the AI panel', () => {
  test('asks the configured provider, applies the code, and keeps the thread', async () => {
    const provider = await startProvider()
    const {page, close} = await launchTinkr({config: aiConfig(provider.endpoint)})

    try {
      await chooseOutputView(page, 'AI')

      await expect(page.getByText('Ask for a snippet, or ask what the code in the editor does.')).toBeVisible()

      const prompt = page.getByRole('textbox', {name: 'AI'})

      await prompt.fill('Write something that adds one and one')
      await page.getByRole('button', {name: 'Ask'}).click()

      await expect(page.locator('.ai__text').last()).toContainText('Here it is.', {timeout: 30_000})
      await expect(page.locator('.ai__turn pre.printed')).toContainText('1 + 1;')
      await expect(page.getByRole('button', {name: 'Apply to the editor'})).toBeVisible()

      // what was asked carried the editor's code, because that switch is on
      const request = provider.seen[provider.seen.length - 1]

      expect(request.url).toBe('/v1/chat/completions')
      expect(request.body.model).toBe('fixture-model')
      expect(JSON.stringify(request.body.messages)).toContain('The editor holds')

      await page.getByRole('button', {name: 'Apply to the editor'}).click()

      await expect(page.getByText('applied to the editor')).toBeVisible()

      // the editor took the code, so running it is running what came back
      await chooseOutputView(page, 'Output')
      await page.locator('.tabbar .btn--run').first().click()
      await expect(page.locator('.output .t-number').first()).toHaveText('2', {timeout: 60_000})

      // a second turn is read against the first, and Discard keeps its code out
      await chooseOutputView(page, 'AI')
      await prompt.fill('Now write a different one')
      await page.getByRole('button', {name: 'Ask'}).click()
      await expect(page.locator('.ai__turn')).toHaveCount(2)
      await expect(page.locator('.ai__turn').last()).toContainText('Here it is.', {timeout: 30_000})

      await page.getByRole('button', {name: 'Discard'}).last().click()
      await expect(page.getByText('discarded')).toBeVisible()
    } finally {
      await provider.close()
      await close()
    }
  })

  test('sends only the context its two switches say to send', async () => {
    const provider = await startProvider()
    const {page, close} = await launchTinkr({config: aiConfig(provider.endpoint)})

    try {
      // a run gives the panel an answer the output switch can leave out
      await runCode(page, '1 + 1;')

      await chooseOutputView(page, 'AI')

      const prompt = page.getByRole('textbox', {name: 'AI'})

      await prompt.fill('what does this do?')
      await page.getByRole('button', {name: 'Ask'}).click()
      await expect(page.locator('.ai__turn')).toHaveCount(1)
      await expect(page.locator('.ai__text').last()).toContainText('Here it is.', {timeout: 30_000})

      const lastUser = () => provider.seen.at(-1).body.messages.filter(message => message.role === 'user').at(-1).content

      expect(lastUser()).toContain('1 + 1;')
      expect(lastUser()).toContain('The last run answered:')

      await page.getByText("the last run's answer", {exact: true}).click()
      await prompt.fill('without the output')
      await page.getByRole('button', {name: 'Ask'}).click()
      await expect(page.locator('.ai__turn')).toHaveCount(2)
      await expect(page.locator('.ai__text').last()).toContainText('Here it is.', {timeout: 30_000})

      expect(lastUser()).toContain('1 + 1;')
      expect(lastUser()).not.toContain('The last run answered:')

      await page.getByText("the editor's code", {exact: true}).click()
      await prompt.fill('without either')
      await page.getByRole('button', {name: 'Ask'}).click()
      await expect(page.locator('.ai__turn')).toHaveCount(3)
      await expect(page.locator('.ai__text').last()).toContainText('Here it is.', {timeout: 30_000})

      expect(lastUser()).not.toContain('1 + 1;')
      expect(lastUser()).toContain('nothing: the editor is empty')
      expect(lastUser()).not.toContain('The last run answered:')
    } finally {
      await provider.close()
      await close()
    }
  })

  test('names project files after @ and sends the one that was picked', async () => {
    const provider = await startProvider()
    const {page, close} = await launchTinkr({config: aiConfig(provider.endpoint)})

    try {
      await chooseOutputView(page, 'AI')

      const prompt = page.getByRole('textbox', {name: 'AI'})

      await prompt.fill('Explain @Ord')

      const list = page.getByRole('listbox')

      await expect(list).toBeVisible()
      await expect(list.getByRole('option').first()).toContainText('Order')

      await list.getByRole('option').first().click()
      await expect(prompt).toHaveValue(/@.*Order/)

      await page.getByRole('button', {name: 'Ask'}).click()
      await expect(page.locator('.ai__text').last()).toContainText('Here it is.', {timeout: 30_000})

      const request = provider.seen[provider.seen.length - 1]

      expect(JSON.stringify(request.body.messages)).toContain('class Order')
    } finally {
      await provider.close()
      await close()
    }
  })

  test('checks the AI settings against the configured endpoint', async () => {
    const provider = await startProvider()
    const {app, page, close} = await launchTinkr({config: aiConfig(provider.endpoint)})

    try {
      const [settings] = await Promise.all([
        app.waitForEvent('window'),
        page.getByRole('button', {name: 'Settings'}).click(),
      ])

      await settings.locator('.app').waitFor({state: 'visible'})
      await settings.getByRole('button', {name: 'AI'}).click()

      await expect(settings.getByLabel('Endpoint')).toHaveValue(provider.endpoint)
      await expect(settings.getByLabel('API token')).toHaveValue('fixture-token')
      await expect(settings.getByLabel('Model')).toHaveValue('fixture-model')

      await settings.getByRole('button', {name: 'Check connection'}).click()

      await expect(settings.getByText('openai answered with model fixture-model: ok')).toBeVisible({timeout: 30_000})
    } finally {
      await provider.close()
      await close()
    }
  })
})
