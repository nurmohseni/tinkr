const http = require('http')
const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')

const startProvider = async () => {
  const seen = []

  const server = http.createServer((request, response) => {
    let body = ''

    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const parsed = (() => {
        try {
          return JSON.parse(body)
        } catch (e) {
          return {}
        }
      })()

      const system = (parsed.messages || []).find(message => message.role === 'system') || {}
      const prompt = String(system.content || '')

      seen.push({url: request.url, body: parsed, completion: prompt.includes('You complete PHP code')})

      response.writeHead(200, {'content-type': 'application/json'})
      response.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: prompt.includes('You complete PHP code') ? '"hello";' : 'Here it is.',
          },
        }],
      }))
    })
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  return {
    seen,
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test.describe('AI autocomplete', () => {
  test('asks for a completion at the cursor, shows it, and takes it', async () => {
    const provider = await startProvider()
    const {page, close} = await launchTinkr({
      config: {
        ai_provider: 'openai',
        ai_endpoint: provider.endpoint,
        ai_token: 'fixture-token',
        ai_model: 'fixture-model',
        ai_autocomplete: true,
        // the delay is the user's, and a test is not waiting for a person
        ai_delay: 0,
      },
    })

    try {
      await page.locator('.editor .monaco-editor').click()
      await page.keyboard.insertText('echo ')

      await expect.poll(() => provider.seen.filter(request => request.completion).length)
        .toBeGreaterThan(0)

      const request = provider.seen.filter(one => one.completion).at(-1)

      expect(request.url).toBe('/v1/chat/completions')
      expect(JSON.stringify(request.body.messages)).toContain('Complete the code at <CURSOR>')
      expect(JSON.stringify(request.body.messages)).toContain('echo <CURSOR>')

      await expect(page.locator('.statusbar')).toContainText('autocomplete on')

      const ghost = page.locator('.ghost-text-decoration').first()

      await expect(ghost).toBeVisible({timeout: 15_000})
      await expect(ghost).toContainText('hello')

      await page.keyboard.press('Tab')

      // the completion was taken as the editor's code; running it prints what
      // the provider answered
      await page.locator('.tabbar .btn--run').first().click()
      await expect(page.locator('.output pre.printed')).toContainText('hello', {timeout: 60_000})
    } finally {
      await provider.close()
      await close()
    }
  })
})
