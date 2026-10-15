jest.mock('electron', () => ({app: {getLocale: () => 'en'}}))
jest.mock('electron-store', () => class Store {
  get(key, fallback) { return fallback }
})

const {providers} = require('../aiProviders')
const {buildMessages, askMessages, buildRequest, readCompletion, clean} = require('../services/ai')

const settings = extra => Object.assign({
  provider: 'openai',
  style: 'openai',
  needsToken: true,
  endpoint: 'https://api.openai.com/v1',
  token: 'secret',
  model: 'gpt-test',
}, extra)

describe('test the provider presets', () => {
  test('should give every provider an endpoint except the custom one', () => {
    const preset = Object.entries(providers).filter(([key]) => key !== 'custom')

    expect(preset.length).toBeGreaterThan(0)
    preset.forEach(([, provider]) => expect(provider.endpoint).toMatch(/^https?:\/\//))
    expect(providers.custom.endpoint).toBe('')
  })

  test('should speak the openai api unless it says otherwise', () => {
    expect(providers.claude.style).toBe('anthropic')
    expect(providers.ollama.needsToken).toBe(false)
    expect(providers.openrouter.endpoint).toBe('https://openrouter.ai/api/v1')
  })
})

describe('test buildMessages', () => {
  test('should mark where the cursor is', () => {
    const messages = buildMessages({prefix: '$user = User::first();\n$user->', suffix: ';\n'})

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].content).toContain('$user = User::first();\n$user-><CURSOR>;\n')
  })
})

describe('test askMessages', () => {
  test('should carry the code the ask is about, and the ask', () => {
    const messages = askMessages({prompt: 'make it a select', code: '$x = 1;', history: []})

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('$x = 1;')
    expect(messages[1].content).toContain('make it a select')
  })

  test('should read an ask against the turns before it', () => {
    const messages = askMessages({
      prompt: 'and now the other one',
      code: '$x = 1;',
      history: [
        {role: 'user', content: 'first'},
        {role: 'assistant', content: 'second'},
      ],
    })

    expect(messages.map(message => message.content.slice(0, 8))).toEqual([
      'You help',
      'first',
      'second',
      'The edit',
    ])
  })

  test('should keep the last turns only, and never the system one twice', () => {
    const history = Array.from({length: 10}, (unused, index) => ({role: 'user', content: `turn ${index}`}))
    const messages = askMessages({prompt: 'now', code: '', history})

    expect(messages).toHaveLength(8)
    expect(messages[1].content).toBe('turn 4')
    expect(messages.filter(message => message.role === 'system')).toHaveLength(1)
  })
})

describe('test buildRequest', () => {
  test('should ask an openai provider for a chat completion', () => {
    const {url, headers, body} = buildRequest(settings(), [{role: 'system', content: 's'}, {role: 'user', content: 'u'}])

    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(headers.authorization).toBe('Bearer secret')
    expect(body.model).toBe('gpt-test')
    expect(body.stream).toBe(false)
    expect(body.temperature).toBe(0)
    // reasoning models answer nothing when the budget is tight
    expect(body.max_tokens).toBeGreaterThanOrEqual(1024)
    expect(body.messages).toHaveLength(2)
  })

  test('should leave the authorization header out when there is no token', () => {
    const {headers} = buildRequest(settings({token: '', needsToken: false, endpoint: 'http://localhost:11434/v1'}), [])

    expect(headers.authorization).toBeUndefined()
  })

  test('should ask anthropic the anthropic way', () => {
    const {url, headers, body} = buildRequest(
      settings({style: 'anthropic', endpoint: 'https://api.anthropic.com'}),
      [{role: 'system', content: 's'}, {role: 'user', content: 'u'}],
    )

    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(headers['x-api-key']).toBe('secret')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.authorization).toBeUndefined()
    expect(body.system).toBe('s')
    expect(body.messages).toEqual([{role: 'user', content: 'u'}])
  })
})

describe('test readCompletion', () => {
  test('should read an openai answer', () => {
    expect(readCompletion(settings(), {choices: [{message: {content: '$user->name'}}]})).toBe('$user->name')
  })

  test('should read an anthropic answer', () => {
    expect(readCompletion(settings({style: 'anthropic'}), {content: [{text: '$user'}, {text: '->name'}]})).toBe('$user->name')
  })

  test('should survive an answer in another shape', () => {
    expect(readCompletion(settings(), {})).toBe('')
  })
})

describe('test clean', () => {
  test('should take the fences and the marker off', () => {
    expect(clean('```php\n<CURSOR>$user->name\n```')).toBe('$user->name')
    expect(clean('$user->name\n')).toBe('$user->name')
  })
})
