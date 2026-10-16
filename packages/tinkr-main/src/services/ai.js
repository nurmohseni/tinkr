const http = require('http')
const https = require('https')
const {URL} = require('url')

const {config} = require('../database/config')
const {providers} = require('../aiProviders')

// reasoning models spend their budget on reasoning before the code, and a
// small max_tokens leaves them with nothing to answer (ollama models hit
// finish_reason length with an empty completion), so this is generous and the
// length of what gets inserted is capped instead
const maxTokens = 1024
const maxCompletion = 4000
// an answer carries the whole snippet back, so it is given more room than a
// completion at the cursor, and more of it is kept
const askMaxTokens = 2048
const maxAnswer = 12000
const timeout = 30000

// what one part of a request may be worth: an editor holding a whole file, a run
// that printed a table, a class of four hundred lines. A request is not a codebase
const maxRequestCode = 12000
const maxRequestFile = 12000
const maxRequestOutput = 6000

/**
 * @param {String} value
 * @param {Number} length
 * @param {String} [comment] what to cut with, when what is cut is code
 * @return {String}
 */
const cutTo = (value, length, comment = '') => (value.length > length
  ? `${value.slice(0, length)}\n${comment}… the rest was not sent`
  : value)

const system = [
  'You complete PHP code that runs inside a Laravel tinker scratchpad.',
  'Answer with the raw code to insert at the cursor and nothing else:',
  'no explanation, no markdown fences, no repetition of the surrounding code.',
  'Keep it as short as the intent allows.',
].join(' ')

/**
 * What the panel asks of the provider, which is either a snippet or an answer
 * about one.
 *
 * The block is the contract with the other side: the panel offers what is in it
 * as the code that would replace the editor's, and reads what is around it as
 * what the model had to say. So the block is the whole snippet whenever there is
 * one, and there is none at all when the user only asked a question.
 */
const askSystem = [
  'You help with PHP that runs inside a Laravel tinker scratchpad.',
  'What the editor holds, what a run last answered, and the project files the',
  'prompt names are written out with the request when they are sent.',
  'When the user asks for code — to write it, to change it, or to fix it — answer',
  'with the whole snippet in one fenced php block, and say what you have to say',
  'about it outside the block and briefly. That block replaces the editor, so it',
  'is always the complete snippet, never a fragment and never a diff.',
  'When the user asks a question instead, answer it in one short paragraph, with',
  'no block at all.',
].join(' ')

/**
 * The provider, endpoint, token and model the user configured.
 *
 * @return {Record<string, any>}
 */
const getSettings = () => {
  const provider = config.get('ai_provider', 'openai')
  const preset = providers[provider] || providers.openai

  return {
    provider,
    style: preset.style || 'openai',
    needsToken: preset.needsToken !== false,
    endpoint: (config.get('ai_endpoint', '').trim() || preset.endpoint).replace(/\/+$/, ''),
    token: config.get('ai_token', '').trim(),
    model: config.get('ai_model', '').trim(),
  }
}

/**
 * @param {Record<string, any>} settings
 */
const assertConfigured = settings => {
  if (!settings.endpoint) {
    throw new Error('Set the endpoint of your provider in the AI settings.')
  }

  if (!settings.model) {
    throw new Error('Set the model name in the AI settings.')
  }

  if (settings.needsToken && !settings.token) {
    throw new Error('Set the api token in the AI settings.')
  }
}

/**
 * @param {{prefix: String, suffix: String}} code
 * @return {Array<Record<String, string>>}
 */
const buildMessages = ({prefix, suffix}) => [
  {role: 'system', content: system},
  {role: 'user', content: `Complete the code at <CURSOR>.\n\n${prefix}<CURSOR>${suffix}`},
]

/**
 * @param {Record<string, any>} settings
 * @param {Array<Record<string, string>>} messages
 * @return {{url: String, headers: Record<string, string>, body: Record<string, any>}}
 */
/**
 * What the last run answered, as a request carries it: the value it returned,
 * what it printed, and the exception that stopped it. This is what a question
 * like "help me debug this" is about.
 *
 * @param {Object} result the run result the window holds
 * @return {String}
 */
const outputBlock = result => {
  const lines = ['The last run answered:']

  if (result.error) {
    lines.push(`\nthrew ${result.error.class}: ${result.error.message}`)
  }

  if (result.value !== null && result.value !== undefined) {
    const value = JSON.stringify(result.value, null, 2) || ''

    lines.push(`\nvalue:\n\`\`\`json\n${cutTo(value, maxRequestOutput)}\n\`\`\``)
  }

  if (result.output) {
    lines.push(`\nprinted:\n\`\`\`\n${cutTo(result.output, maxRequestOutput)}\n\`\`\``)
  }

  if (lines.length === 1) {
    lines.push('\nnothing: it returned nothing and printed nothing.')
  }

  return lines.join('\n')
}

/**
 * What a request carries besides the prompt: the code the editor holds, the
 * project files the prompt names, and the last run's answer — each of them only
 * when the panel was asked to send it.
 *
 * @param {{prompt: String, code?: String, history?: Array, output?: Object,
 *   files?: Array}} ask
 * @return {Array<Record<String, String>>}
 */
const askMessages = ({prompt, code = '', history = [], output = null, files = []}) => {
  const blocks = [
    `The editor holds:\n\n\`\`\`php\n${code.trim() === ''
      ? '// nothing: the editor is empty'
      : cutTo(code, maxRequestCode, '// ')}\n\`\`\``,
  ]

  if (files.length) {
    blocks.push([
      'The project files the prompt names:',
      ...files.map(file => `\`\`\`php\n// ${file.path}\n${cutTo(file.code, maxRequestFile, '// ')}\n\`\`\``),
    ].join('\n\n'))
  }

  if (output) {
    blocks.push(outputBlock(output))
  }

  return [
    {role: 'system', content: askSystem},
    // the last turns, so `now make it a select` is read against what came before
    // it; a failed one is left out by the panel
    ...history.slice(-6),
    {role: 'user', content: `${blocks.join('\n\n')}\n\n${prompt}`},
  ]
}

/**
 * @param {Record<string, any>} settings
 * @param {Array<Record<string, string>>} messages
 * @return {{url: String, headers: Record<string, string>, body: Record<string, any>}}
 */
const buildRequest = (settings, messages) => {
  if (settings.style === 'anthropic') {
    return {
      // the anthropic api lives under /v1, and pasting the whole url into the
      // endpoint field is the obvious thing to do
      url: `${settings.endpoint.replace(/\/v1$/, '')}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.token,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: settings.model,
        max_tokens: maxTokens,
        system: messages[0].content,
        messages: messages.slice(1),
      },
    }
  }

  const headers = {
    'content-type': 'application/json',
  }

  if (settings.token) {
    headers.authorization = `Bearer ${settings.token}`
  }

  return {
    url: `${settings.endpoint}/chat/completions`,
    headers,
    body: {
      model: settings.model,
      max_tokens: maxTokens,
      temperature: 0,
      stream: false,
      messages,
    },
  }
}

/**
 * @param {Record<string, any>} settings
 * @param {Record<string, any>} body
 * @return {String}
 */
const readCompletion = (settings, body) => {
  if (settings.style === 'anthropic') {
    return (body.content || []).map(part => part.text || '').join('')
  }

  const [choice] = body.choices || []

  return choice && choice.message ? choice.message.content || '' : ''
}

/**
 * @param {Record<string, any>} parsed
 * @param {String} raw
 * @param {Number} status
 * @return {String}
 */
const errorMessage = (parsed, raw, status) => {
  const message = parsed && ((parsed.error && parsed.error.message) || parsed.message)

  if (message) {
    return message
  }

  return raw ? raw.slice(0, 300) : `The provider answered with ${status}`
}

/**
 * @param {{url: String, headers: Record<string, string>, body: Record<string, any>}} request
 * @return {Promise<Record<string, any>>}
 */
const send = ({url, headers, body}) => new Promise((resolve, reject) => {
  const target = new URL(url)
  const payload = JSON.stringify(body)
  const client = target.protocol === 'https:' ? https : http

  const req = client.request({
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: 'POST',
    headers: Object.assign({}, headers, {'content-length': Buffer.byteLength(payload)}),
  }, res => {
    let raw = ''

    res.setEncoding('utf8')
    res.on('data', chunk => {
      raw += chunk
    })
    res.on('end', () => {
      let parsed = null

      try {
        parsed = JSON.parse(raw)
      } catch (e) {
        parsed = null
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(errorMessage(parsed, raw, res.statusCode)))
        return
      }

      if (!parsed) {
        reject(new Error('The provider answered with something that is not json.'))
        return
      }

      resolve(parsed)
    })
  })

  req.on('error', error => reject(new Error(`Could not reach ${url}: ${error.message}`)))
  req.setTimeout(timeout, () => req.destroy(new Error(`No answer from ${url} in ${timeout / 1000}s`)))
  req.write(payload)
  req.end()
})

/**
 * The completion answers with code, whatever the model felt like wrapping it in.
 *
 * @param {String} text
 * @return {String}
 */
const clean = text => text
  .replace(/^```[a-zA-Z]*\n/, '')
  .replace(/\n?```\s*$/, '')
  .replace(/^<CURSOR>\s*/, '')
  .replace(/\s+$/, '')

/**
 * Ask the configured provider for the code at the cursor.
 *
 * @param {{prefix: String, suffix: String}} code
 * @return {Promise<{completion: String}>}
 */
const complete = async code => {
  const settings = getSettings()

  assertConfigured(settings)

  const answer = await send(buildRequest(settings, buildMessages(code)))

  return {
    completion: clean(readCompletion(settings, answer)).slice(0, maxCompletion),
  }
}

/**
 * Ask the configured provider for a snippet, or for what the snippet does.
 *
 * @param {{prompt: String, code?: String, history?: Array, output?: Object,
 *   files?: Array}} ask
 * @return {Promise<{answer: String}>}
 */
const ask = async ({prompt, code, history, output, files}) => {
  const settings = getSettings()

  assertConfigured(settings)

  const request = buildRequest(settings, askMessages({prompt, code, history, output, files}))

  const answer = await send(Object.assign({}, request, {
    body: Object.assign({}, request.body, {max_tokens: askMaxTokens, temperature: 0.2}),
  }))

  return {answer: readCompletion(settings, answer).trim().slice(0, maxAnswer)}
}

/**
 * Ask the configured provider something small, so the settings can be checked
 * without running a completion.
 *
 * @return {Promise<{provider: String, model: String, answer: String}>}
 */
const check = async () => {
  const settings = getSettings()

  assertConfigured(settings)

  const messages = [
    {role: 'system', content: 'Answer with the single word: ok'},
    {role: 'user', content: 'ok'},
  ]

  const answer = await send(buildRequest(settings, messages))

  return {
    provider: settings.provider,
    model: settings.model,
    answer: clean(readCompletion(settings, answer)).slice(0, 60),
  }
}

module.exports = {
  getSettings,
  askMessages,
  outputBlock,
  ask,
  buildMessages,
  buildRequest,
  readCompletion,
  clean,
  complete,
  check,
}
