const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  VAPOR_SECRET_KEY, VAPOR_COMMAND_LIMIT, VaporError, vaporApiUrl, isVapor, vaporRequest,
  vaporTeams, vaporProjects, vaporEnvironments, vaporCommand, vaporOutputOf, vaporTokenOf,
  vaporCliCredentials, runVapor,
} = require('../vapor')

/**
 * A fetch that answers from a table of responses, and records what was asked.
 *
 * The whole protocol is HTTP against Laravel Vapor, and a test that reached the
 * network would be a test of Laravel Vapor's uptime. Each answer is a body or a
 * status, and the calls are kept so a test can say what was asked.
 *
 * @param {Function} answer `(method, url, body) => {status, body}`
 * @return {{fetch: Function, calls: Array<{method: String, url: String,
 *   body: Object, headers: Object}>}}
 */
const fakeFetch = answer => {
  const calls = []
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null

    calls.push({method: init.method, url, body, headers: init.headers})

    const {status = 200, body: answered} = answer(init.method, url, body) || {}

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => answered,
    }
  }

  return {fetch, calls}
}

/**
 * The code a vapor command carries, and the markers a wrapped run printed.
 *
 * They are made new for every run, so a test reads them from the command rather
 * than guessing — which also proves the command carries the wrapped code intact.
 *
 * @param {String} command the shell command the API was sent
 * @return {String}
 */
const codeOf = command => {
  const encoded = /eval\(base64_decode\("([^"]+)"\)\);'$/.exec(command)[1]

  return Buffer.from(encoded, 'base64').toString('utf8')
}

const wrapped = command => {
  const code = codeOf(command)
  const marker = /^\$tinkr='(\w+)'\.'(\w+)';/.exec(code)
  const start = /\$tinkr_start='(\w+)'\.'(\w+)';/.exec(code)

  return {start: start[1] + start[2], marker: marker[1] + marker[2], code}
}

/**
 * What a wrapped run printed for Laravel Vapor: the start marker, whatever the
 * snippet printed, then the marker with the base64 envelope between two `@`.
 *
 * @param {String} command
 * @param {Object} payload the envelope
 * @param {String} [printed]
 * @return {String}
 */
const outputOf = (command, payload, printed = '') => {
  const {start, marker} = wrapped(command)
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')

  return `${start}${printed}\n${marker}@${encoded}@`
}

/**
 * What the API's `output` field carries for a command: base64 of a JSON string
 * `{output, context}`, which is one layer above the text the command printed.
 *
 * @param {String} printed the command's own output
 * @return {String}
 */
const storedOutput = printed => Buffer.from(
  JSON.stringify({output: printed, context: {}}),
  'utf8',
).toString('base64')

const envelope = {blocks: [], value: 42, error: null, queries: [], queriesTotal: 0, imported: {}}

const vaporConnection = {
  id: 'vaporone',
  name: 'shop · production',
  is_vapor: true,
  is_over_ssh: false,
  container_engine: '',
  command: '',
  path: '',
  vapor_project_id: 'proj1',
  vapor_project_name: 'shop',
  vapor_environment_name: 'production',
}

describe('a Laravel Vapor connection', () => {
  // every test talks to the real API root unless it sets one itself, so a
  // TINKR_LARAVEL_VAPOR_URL left over from an e2e run cannot move them
  const originalUrl = process.env.TINKR_LARAVEL_VAPOR_URL

  beforeEach(() => {
    delete process.env.TINKR_LARAVEL_VAPOR_URL
  })

  afterAll(() => {
    if (originalUrl === undefined) {
      delete process.env.TINKR_LARAVEL_VAPOR_URL
    } else {
      process.env.TINKR_LARAVEL_VAPOR_URL = originalUrl
    }
  })

  test('is a vapor connection only when it says it is', () => {
    expect(isVapor(vaporConnection)).toBe(true)
    expect(isVapor({is_vapor: false})).toBe(false)
    expect(isVapor({})).toBe(false)
    expect(isVapor(null)).toBe(false)
  })

  test('reads the API root from the environment on every call', () => {
    expect(vaporApiUrl()).toBe('https://vapor.laravel.com')

    // the e2e suite points the app at a fake server after the module is loaded,
    // which is why the variable is read per call rather than once at load
    process.env.TINKR_LARAVEL_VAPOR_URL = 'http://127.0.0.1:9999'

    try {
      expect(vaporApiUrl()).toBe('http://127.0.0.1:9999')
    } finally {
      delete process.env.TINKR_LARAVEL_VAPOR_URL
    }
  })

  test('runs the wrapped code as an artisan tinker command without the artisan prefix', () => {
    const code = '$tinkr_code = base64_decode(\'YWJj\'); echo "it\'s";'
    const encoded = Buffer.from(code, 'utf8').toString('base64')
    const command = vaporCommand(code)

    // Vapor already runs `php $ROOT/artisan <command> --no-interaction`, so the
    // command is the part after artisan and not a second php
    expect(command).toBe(`tinker --execute='eval(base64_decode("${encoded}"));'`)
    expect(command).not.toContain('php artisan')
    // nothing of the snippet can end the shell's quoting: base64 has no quote in
    // its alphabet, so the command stays one word to the shell whatever it holds
    expect(codeOf(command)).toBe(code)
  })

  test('refuses a run that is larger than the API accepts, and says the sizes', () => {
    let error = null

    try {
      vaporCommand('x'.repeat(160000))
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(VaporError)
    expect(error.code).toBe('too_large')
    expect(error.message).toContain('213')
    expect(error.message).toContain(String(VAPOR_COMMAND_LIMIT))

    // a run that fits is sent
    expect(vaporCommand('x'.repeat(1000)).length).toBeLessThan(VAPOR_COMMAND_LIMIT)
  })

  test('decodes a command\'s output from base64 and from its JSON envelope', () => {
    const printed = 'array:1 [\n  0 => 42\n]'

    expect(vaporOutputOf(storedOutput(printed))).toBe(printed)
    // a JSON value without an output is a command that printed nothing
    expect(vaporOutputOf(storedOutput(''))).toBe('')
    // not written yet is not the same as printed nothing
    expect(vaporOutputOf(null)).toBe(null)
    expect(vaporOutputOf(undefined)).toBe(null)
    // a decoded value that is not JSON is the text itself, and so is a value the
    // API stored unwrapped
    expect(vaporOutputOf(Buffer.from(printed, 'utf8').toString('base64'))).toBe(printed)
    expect(vaporOutputOf('In Application.php line 12:')).toBe('In Application.php line 12:')
  })

  test('sends the token and the plain JSON headers Laravel Vapor requires', async () => {
    const {fetch, calls} = fakeFetch(() => ({body: []}))

    await vaporRequest('secret-token', 'GET', '/api/teams', {fetch})

    expect(calls[0].url).toBe('https://vapor.laravel.com/api/teams')
    expect(calls[0].method).toBe('GET')
    expect(calls[0].headers.Authorization).toBe('Bearer secret-token')
    // no JSON:API wrapper: the API answers a list or a resource, so the headers
    // are the plain ones
    expect(calls[0].headers.Accept).toBe('application/json')
    expect(calls[0].headers['Content-Type']).toBe('application/json')
  })

  test('reads the teams, their projects and each project\'s environments', async () => {
    const {fetch, calls} = fakeFetch((method, url) => {
      if (url.endsWith('/api/teams')) {
        return {body: [{id: 1, name: 'Acme'}, {id: 2, name: 'Other'}]}
      }

      if (url.endsWith('/api/teams/1/projects')) {
        return {body: [{id: 10, name: 'Shop', team_id: 1}]}
      }

      return {
        body: [{
          id: 100,
          name: 'production',
          project_id: 10,
          vanity_domain: 'shop.laravel-vapor.com',
        }],
      }
    })

    // the ids the API writes as numbers are strings by the time the app sees
    // them, because a connection stores them and compares them as text
    await expect(vaporTeams('token', {fetch})).resolves.toEqual([
      {id: '1', name: 'Acme'},
      {id: '2', name: 'Other'},
    ])
    await expect(vaporProjects('token', '1', {fetch})).resolves.toEqual([{id: '10', name: 'Shop'}])
    await expect(vaporEnvironments('token', '10', {fetch})).resolves.toEqual([
      {id: '100', name: 'production', domain: 'shop.laravel-vapor.com'},
    ])

    expect(calls.map(call => call.url)).toEqual([
      'https://vapor.laravel.com/api/teams',
      'https://vapor.laravel.com/api/teams/1/projects',
      'https://vapor.laravel.com/api/projects/10/environments',
    ])
  })

  test('says what an HTTP error means', async () => {
    const failing = status => fakeFetch(() => ({status, body: {message: `answer ${status}`}})).fetch

    const of = async (call, status) => {
      try {
        await call(failing(status))

        return null
      } catch (e) {
        return e
      }
    }

    const unauthorized = await of(fetchIt => vaporRequest('token', 'GET', '/api/teams', {fetch: fetchIt}), 401)

    expect(unauthorized).toBeInstanceOf(VaporError)
    expect(unauthorized.name).toBe('VaporError')
    expect(unauthorized.code).toBe('unauthorized')
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.message).toBe('The Laravel Vapor API token is invalid or has expired.')

    // Vapor tokens carry no scopes, so a 403 names no permission: there is no
    // checkbox to point at
    const forbidden = await of(fetchIt => vaporRequest('token', 'GET', '/api/teams', {fetch: fetchIt}), 403)

    expect(forbidden.code).toBe('forbidden')
    expect(forbidden.message).toBe('The Laravel Vapor API token is not allowed to make this call.')
    expect(forbidden.message).not.toContain('permission')

    const notFound = await of(fetchIt => vaporRequest('token', 'GET', '/api/projects/nope', {fetch: fetchIt}), 404)

    expect(notFound.code).toBe('not_found')

    const invalid = await of(fetchIt => vaporRequest(
      'token',
      'POST',
      '/api/projects/proj1/environments/production/commands',
      {body: {}, fetch: fetchIt},
    ), 422)

    expect(invalid.code).toBe('validation')
    // the API's own sentence is the one to show: it names the field
    expect(invalid.message).toBe('answer 422')

    expect((await of(fetchIt => vaporRequest('token', 'GET', '/api/teams', {fetch: fetchIt}), 429)).code)
      .toBe('rate_limited')
  })

  test('calls a fetch that cannot reach Laravel Vapor a network error', async () => {
    const fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND vapor.laravel.com')
    }

    await expect(vaporRequest('token', 'GET', '/api/teams', {fetch})).rejects.toMatchObject({
      name: 'VaporError',
      code: 'network',
    })
  })

  test('follows a command to its answer, through every status on the way', async () => {
    const statuses = ['pending', 'running', 'running', 'finished']
    let polls = 0
    const {fetch, calls} = fakeFetch(method => {
      if (method === 'POST') {
        return {body: {id: 'cmd1', status: 'pending'}}
      }

      const status = statuses[polls]

      polls++

      return {
        body: {
          id: 'cmd1',
          status,
          output: status === 'finished'
            ? storedOutput(outputOf(calls[0].body.command, envelope, 'array:1 [\n  0 => 42\n]'))
            : null,
          status_code: status === 'finished' ? 0 : null,
        },
      }
    })

    const result = await runVapor(vaporConnection, 'return 42;', {token: 'token', fetch, interval: 0})

    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://vapor.laravel.com/api/projects/proj1/environments/production/commands')
    // the run is one shell command, and it carries the wrapped code intact
    expect(calls[0].body.command.startsWith('tinker --execute=\'eval(base64_decode("')).toBe(true)
    expect(calls[1].url).toBe('https://vapor.laravel.com/api/commands/cmd1')
    expect(polls).toBe(4)

    // the same shape a pty run answers with, plus the command that ran it
    expect(result).toMatchObject(envelope)
    expect(result.output).toBe('array:1 [\n  0 => 42\n]')
    expect(result.commandId).toBe('cmd1')
  })

  test('encodes the environment name into the command URL', async () => {
    const {fetch, calls} = fakeFetch(method => (method === 'POST'
      ? {body: {id: 'cmd2'}}
      : {body: {id: 'cmd2', status: 'finished', status_code: 0, output: storedOutput(outputOf(calls[0].body.command, envelope))}}))

    await runVapor(
      Object.assign({}, vaporConnection, {vapor_environment_name: 'staging 1'}),
      'return 42;',
      {token: 'token', fetch, interval: 0},
    )

    expect(calls[0].url).toBe('https://vapor.laravel.com/api/projects/proj1/environments/staging%201/commands')
  })

  test('answers the decoded output of a command that printed no JSON', async () => {
    const printed = 'array:1 [\n  0 => 42\n]'
    const {fetch, calls} = fakeFetch(method => (method === 'POST'
      ? {body: {id: 'cmd3'}}
      : {
          body: {
            id: 'cmd3',
            status: 'finished',
            status_code: 0,
            // the command's wrapper output decoded to text that is not a JSON
            // document of its own: the text is what it printed, and the filter
            // reads it exactly as it reads a session's stream
            output: Buffer.from(outputOf(calls[0].body.command, envelope, printed), 'utf8').toString('base64'),
          },
        }))

    const result = await runVapor(vaporConnection, 'return 42;', {token: 'token', fetch, interval: 0})

    expect(result.value).toBe(42)
    expect(result.output).toBe(printed)
  })

  test('asks again when a finished command has not written its output yet', async () => {
    let polls = 0
    let command = ''
    const {fetch} = fakeFetch((method, url, body) => {
      if (method === 'POST') {
        command = body.command

        return {body: {id: 'cmd4'}}
      }

      polls++

      return {
        body: {
          id: 'cmd4',
          status: 'finished',
          status_code: 0,
          // the status is stored before the output is, so the first poll of a
          // finished command can carry null and still have an answer
          output: polls === 1 ? null : storedOutput(outputOf(command, envelope, 'printed')),
        },
      }
    })

    const result = await runVapor(vaporConnection, 'echo "printed"; return 42;', {
      token: 'token',
      fetch,
      interval: 0,
    })

    expect(polls).toBe(2)
    expect(result.value).toBe(42)
    expect(result.output).toBe('printed')
  })

  test('reports a command that failed by what it said, with its exit code', async () => {
    const {fetch} = fakeFetch(method => (method === 'POST'
      ? {body: {id: 'cmd5'}}
      : {
          body: {
            id: 'cmd5',
            status: 'finished',
            status_code: 1,
            output: storedOutput('In Application.php line 12:\n\n  Call to undefined method App\\Models\\User::nope()\n'),
          },
        }))

    let error = null

    try {
      await runVapor(vaporConnection, 'User::nope();', {token: 'token', fetch, interval: 0})
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(VaporError)
    expect(error.code).toBe('failed')
    expect(error.commandId).toBe('cmd5')
    expect(error.exitCode).toBe(1)
    expect(error.message).toContain('Call to undefined method App\\Models\\User::nope()')
    // a failure is a command that finished with a non-zero code, and the message
    // says both: the status alone would read as a success that printed nothing
    expect(error.message).toContain('exited with code 1')
  })

  test('refuses to run without a token or without an environment', async () => {
    const {fetch, calls} = fakeFetch(() => ({body: []}))

    await expect(runVapor(vaporConnection, '1;', {fetch})).rejects.toMatchObject({code: 'no_token'})
    await expect(runVapor(
      Object.assign({}, vaporConnection, {vapor_environment_name: ''}),
      '1;',
      {token: 'token', fetch},
    )).rejects.toMatchObject({code: 'validation'})
    await expect(runVapor(
      Object.assign({}, vaporConnection, {vapor_project_id: ''}),
      '1;',
      {token: 'token', fetch},
    )).rejects.toMatchObject({code: 'validation'})
    expect(calls).toHaveLength(0)
  })

  test('reads the token out of the app\'s secrets file, and tolerates its absence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-vapor-'))

    try {
      // no file at all is no token, not a crash on start
      expect(vaporTokenOf(dir)).toBe('')
      expect(vaporTokenOf('')).toBe('')

      fs.mkdirSync(path.join(dir, 'app'), {recursive: true})
      fs.writeFileSync(path.join(dir, 'app', 'secrets.json'), JSON.stringify({
        someConnectionId: 'ssh-password',
        [VAPOR_SECRET_KEY]: 'the-vapor-token',
      }))

      expect(vaporTokenOf(dir)).toBe('the-vapor-token')

      // a corrupt file is still no token
      fs.writeFileSync(path.join(dir, 'app', 'secrets.json'), '{not json')

      expect(vaporTokenOf(dir)).toBe('')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  test('reads the token the Vapor CLI saved, and treats its absence as none', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-vapor-home-'))

    try {
      // a machine where the CLI was never used is not an error: the token is
      // then something to ask for, not something to report as broken
      expect(vaporCliCredentials(home)).toBe(null)

      fs.mkdirSync(path.join(home, '.laravel-vapor'), {recursive: true})
      fs.writeFileSync(
        path.join(home, '.laravel-vapor', 'config.json'),
        JSON.stringify({token: 'cli-token', team: 'acme'}),
      )

      expect(vaporCliCredentials(home)).toEqual({token: 'cli-token', team: 'acme'})

      // the file belongs to another program, so a shape without a token is null
      // rather than a token that is an object
      fs.writeFileSync(path.join(home, '.laravel-vapor', 'config.json'), JSON.stringify({team: 'acme'}))

      expect(vaporCliCredentials(home)).toBe(null)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  })
})
