const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  CLOUD_SECRET_KEY, CLOUD_COMMAND_LIMIT, CloudError, cloudApiUrl, isCloud, cloudRequest,
  cloudApplications, cloudEnvironment, cloudCommand, runCloud, cloudTokenOf,
} = require('../cloud')
const {runCode} = require('../session')

/**
 * A fetch that answers from a table of responses, and records what was asked.
 *
 * The whole protocol is HTTP against Laravel Cloud, and a test that reached the
 * network would be a test of Laravel Cloud's uptime. Each answer is a JSON:API
 * body or a status, and the calls are kept so a test can say what was asked.
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

const application = (id, name, environmentIds) => ({
  type: 'applications',
  id,
  attributes: {name, slug: name.toLowerCase(), region: 'us-east-1'},
  relationships: {
    environments: {data: environmentIds.map(one => ({type: 'environments', id: one}))},
  },
})

const environment = (id, name) => ({
  type: 'environments',
  id,
  attributes: {
    name,
    slug: name.toLowerCase(),
    status: 'running',
    php_major_version: '8.4',
    vanity_domain: `${name.toLowerCase()}.laravel.cloud`,
  },
})

const asEnvironment = (id, name) => ({
  id,
  name,
  slug: name.toLowerCase(),
  status: 'running',
  phpVersion: '8.4',
  domain: `${name.toLowerCase()}.laravel.cloud`,
})

/**
 * The code a cloud command carries, and the markers a wrapped run printed.
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
 * What Laravel Cloud prints for a run: the shape the wrapper writes, which is
 * the start marker, whatever the snippet printed, then the marker with the
 * base64 envelope between two `@`.
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

const envelope = {blocks: [], value: 42, error: null, queries: [], queriesTotal: 0, imported: {}}

const cloudConnection = {
  id: 'cloudone',
  name: 'shop · production',
  is_cloud: true,
  is_over_ssh: false,
  container_engine: '',
  command: '',
  path: '',
  cloud_application_id: 'app1',
  cloud_application_name: 'shop',
  cloud_environment_id: 'env1',
  cloud_environment_name: 'production',
}

describe('a Laravel Cloud connection', () => {
  // every test talks to the real API root unless it sets one itself, so a
  // TINKR_LARAVEL_CLOUD_URL left over from an e2e run cannot move them
  const originalUrl = process.env.TINKR_LARAVEL_CLOUD_URL

  beforeEach(() => {
    delete process.env.TINKR_LARAVEL_CLOUD_URL
  })

  afterAll(() => {
    if (originalUrl === undefined) {
      delete process.env.TINKR_LARAVEL_CLOUD_URL
    } else {
      process.env.TINKR_LARAVEL_CLOUD_URL = originalUrl
    }
  })

  test('is a cloud connection only when it says it is', () => {
    expect(isCloud(cloudConnection)).toBe(true)
    expect(isCloud({is_cloud: false})).toBe(false)
    expect(isCloud({})).toBe(false)
    expect(isCloud(null)).toBe(false)
  })

  test('reads the API root from the environment on every call', () => {
    expect(cloudApiUrl()).toBe('https://cloud.laravel.com/api')

    // the e2e suite points the app at a fake server after the module is loaded,
    // which is why the variable is read per call rather than once at load
    process.env.TINKR_LARAVEL_CLOUD_URL = 'http://127.0.0.1:9999/api'

    try {
      expect(cloudApiUrl()).toBe('http://127.0.0.1:9999/api')
    } finally {
      delete process.env.TINKR_LARAVEL_CLOUD_URL
    }
  })

  test('runs the wrapped code as a base64 artisan tinker command', () => {
    const code = '$tinkr_code=base64_decode(\'YWJj\');echo "it\'s";'
    const encoded = Buffer.from(code, 'utf8').toString('base64')
    const command = cloudCommand(code)

    expect(command).toBe(`php artisan tinker --execute='eval(base64_decode("${encoded}"));'`)

    // nothing of the snippet can end the shell's quoting: base64 has no quote in
    // its alphabet, so the command stays one word to the shell whatever it holds
    expect(codeOf(command)).toBe(code)
  })

  test('refuses a run that is larger than the API accepts, and says the sizes', () => {
    let error = null

    try {
      cloudCommand('x'.repeat(120000))
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(CloudError)
    expect(error.code).toBe('too_large')
    expect(error.message).toContain('160000')
    expect(error.message).toContain(String(CLOUD_COMMAND_LIMIT))

    // a run that fits is sent
    expect(cloudCommand('x'.repeat(1000)).length).toBeLessThan(CLOUD_COMMAND_LIMIT)
  })

  test('sends the token and the JSON:API headers Laravel Cloud requires', async () => {
    const {fetch, calls} = fakeFetch(() => ({body: {data: []}}))

    await cloudRequest('secret-token', 'GET', '/applications', {fetch})

    expect(calls[0].url).toBe('https://cloud.laravel.com/api/applications')
    expect(calls[0].method).toBe('GET')
    expect(calls[0].headers.Authorization).toBe('Bearer secret-token')
    expect(calls[0].headers.Accept).toBe('application/vnd.api+json')
    expect(calls[0].headers['Content-Type']).toBe('application/vnd.api+json')
  })

  test('reads every page of applications with their included environments', async () => {
    const next = 'https://cloud.laravel.com/api/applications?include=environments&page=2'
    const {fetch, calls} = fakeFetch((method, url) => (url === next
      ? {
          body: {
            data: [application('app2', 'Admin', ['env3'])],
            included: [environment('env3', 'staging')],
            links: {next: null},
          },
        }
      : {
          body: {
            data: [application('app1', 'Shop', ['env1', 'env2'])],
            included: [environment('env1', 'production'), environment('env2', 'staging')],
            links: {next},
          },
        }))

    const applications = await cloudApplications('token', {fetch})

    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe(next)
    expect(applications).toEqual([
      {
        id: 'app1',
        name: 'Shop',
        slug: 'shop',
        region: 'us-east-1',
        environments: [asEnvironment('env1', 'production'), asEnvironment('env2', 'staging')],
      },
      {
        id: 'app2',
        name: 'Admin',
        slug: 'admin',
        region: 'us-east-1',
        environments: [asEnvironment('env3', 'staging')],
      },
    ])
  })

  test('reads one environment by its id', async () => {
    const {fetch, calls} = fakeFetch(() => ({body: {data: environment('env1', 'production')}}))

    await expect(cloudEnvironment('token', 'env1', {fetch})).resolves.toEqual(asEnvironment('env1', 'production'))
    expect(calls[0].url).toBe('https://cloud.laravel.com/api/environments/env1')
  })

  test('says what an HTTP error means, naming the permission a 403 needs', async () => {
    const failing = status => fakeFetch(() => ({status, body: {message: `answer ${status}`}})).fetch

    const of = async (call, status) => {
      try {
        await call(failing(status))

        return null
      } catch (e) {
        return e
      }
    }

    const unauthorized = await of(fetchIt => cloudRequest('token', 'GET', '/applications', {fetch: fetchIt}), 401)

    expect(unauthorized).toBeInstanceOf(CloudError)
    expect(unauthorized.code).toBe('unauthorized')
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.message).toBe('The Laravel Cloud API token is invalid or has expired.')

    // a 403 names the checkbox to tick, which is the only thing that fixes it
    expect((await of(fetchIt => cloudRequest('token', 'GET', '/applications', {fetch: fetchIt}), 403)).message)
      .toContain('Applications: View applications')
    expect((await of(fetchIt => cloudRequest('token', 'GET', '/environments/env1', {fetch: fetchIt}), 403)).message)
      .toContain('Environments: View environments')
    expect((await of(fetchIt => cloudRequest(
      'token',
      'POST',
      '/environments/env1/commands',
      {body: {command: 'php artisan'}, fetch: fetchIt},
    ), 403)).message).toContain('Environments: Create environment commands')
    expect((await of(fetchIt => cloudRequest('token', 'GET', '/commands/cmd1', {fetch: fetchIt}), 403)).message)
      .toContain('Environments: Create environment commands')

    const notFound = await of(fetchIt => cloudRequest('token', 'GET', '/environments/nope', {fetch: fetchIt}), 404)

    expect(notFound.code).toBe('not_found')

    const invalid = await of(fetchIt => cloudRequest(
      'token',
      'POST',
      '/environments/env1/commands',
      {body: {}, fetch: fetchIt},
    ), 422)

    expect(invalid.code).toBe('validation')
    // the API's own sentence is the one to show: it names the field
    expect(invalid.message).toBe('answer 422')

    expect((await of(fetchIt => cloudRequest('token', 'GET', '/applications', {fetch: fetchIt}), 429)).code)
      .toBe('rate_limited')
  })

  test('calls a fetch that cannot reach Laravel Cloud a network error', async () => {
    const fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND cloud.laravel.com')
    }

    await expect(cloudRequest('token', 'GET', '/applications', {fetch})).rejects.toMatchObject({
      name: 'CloudError',
      code: 'network',
    })
  })

  test('follows a command to its answer, through every status on the way', async () => {
    const statuses = ['command.created', 'command.running', 'command.running', 'command.success']
    let polls = 0
    const {fetch, calls} = fakeFetch(method => {
      if (method === 'POST') {
        return {body: {data: {type: 'commands', id: 'cmd1', attributes: {status: 'pending'}}}}
      }

      const status = statuses[polls]

      polls++

      return {
        body: {
          data: {
            type: 'commands',
            id: 'cmd1',
            attributes: {
              command: 'php artisan tinker --execute=…',
              output: status === 'command.success'
                ? outputOf(calls[0].body.command, envelope, 'array:1 [\n  0 => 42\n]')
                : null,
              status,
              exit_code: status === 'command.success' ? 0 : null,
              failure_reason: null,
              started_at: '2026-10-21T10:00:00Z',
              finished_at: status === 'command.success' ? '2026-10-21T10:00:01Z' : null,
            },
          },
        },
      }
    })

    const result = await runCloud(cloudConnection, 'return 42;', {token: 'token', fetch, interval: 0})

    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://cloud.laravel.com/api/environments/env1/commands')
    // the run is one shell command, and it carries the wrapped code intact
    expect(calls[0].body.command.startsWith('php artisan tinker --execute=\'eval(base64_decode("')).toBe(true)
    expect(wrapped(calls[0].body.command).code).toContain('$tinkr_code=base64_decode(')
    expect(calls[1].url).toBe('https://cloud.laravel.com/api/commands/cmd1')
    expect(polls).toBe(4)

    // the same shape a pty run answers with, plus the command that ran it
    expect(result).toMatchObject(envelope)
    expect(result.output).toBe('array:1 [\n  0 => 42\n]')
    expect(result.commandId).toBe('cmd1')
  })

  test('reports a failed command by what it said, when there is no envelope', async () => {
    const {fetch} = fakeFetch(method => (method === 'POST'
      ? {body: {data: {type: 'commands', id: 'cmd2'}}}
      : {
          body: {
            data: {
              type: 'commands',
              id: 'cmd2',
              attributes: {
                output: 'In Application.php line 12:\n\n  Call to undefined method App\\Models\\User::nope()\n',
                status: 'command.failure',
                exit_code: 1,
                failure_reason: null,
              },
            },
          },
        }))

    let error = null

    try {
      await runCloud(cloudConnection, 'User::nope();', {token: 'token', fetch, interval: 0})
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(CloudError)
    expect(error.code).toBe('failed')
    expect(error.commandId).toBe('cmd2')
    expect(error.exitCode).toBe(1)
    expect(error.message).toContain('Call to undefined method App\\Models\\User::nope()')
    expect(error.message).toContain('exited with code 1')
  })

  test('prefers the failure reason to the output when the API gives one', async () => {
    const {fetch} = fakeFetch(method => (method === 'POST'
      ? {body: {data: {type: 'commands', id: 'cmd3'}}}
      : {
          body: {
            data: {
              type: 'commands',
              id: 'cmd3',
              attributes: {
                output: 'booting…',
                status: 'command.failure',
                exit_code: 137,
                failure_reason: 'The command was killed because it ran out of memory.',
              },
            },
          },
        }))

    await expect(runCloud(cloudConnection, 'memory();', {token: 'token', fetch, interval: 0})).rejects.toMatchObject({
      code: 'failed',
      commandId: 'cmd3',
      exitCode: 137,
      message: 'The command was killed because it ran out of memory.\n\nThe command exited with code 137.',
    })
  })

  test('gives up waiting after the timeout, and says the command is still running', async () => {
    const {fetch} = fakeFetch(method => (method === 'POST'
      ? {body: {data: {type: 'commands', id: 'cmd4'}}}
      : {body: {data: {type: 'commands', id: 'cmd4', attributes: {status: 'command.running', output: null}}}}))

    const started = Date.now()
    let error = null

    try {
      await runCloud(cloudConnection, 'sleep(600);', {token: 'token', fetch, timeout: 30, interval: 5})
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(CloudError)
    expect(error.code).toBe('timeout')
    expect(error.commandId).toBe('cmd4')
    expect(error.message).toContain('Laravel Cloud keeps running command cmd4 until it ends')
    // the timeout settles the run rather than leaving the poll going
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test('stops when the caller aborts, and names the command left running', async () => {
    const controller = new AbortController()
    const {fetch} = fakeFetch(method => {
      if (method === 'POST') {
        return {body: {data: {type: 'commands', id: 'cmd5'}}}
      }

      // the run is stopped between two polls, the way Stop does it
      controller.abort()

      return {body: {data: {type: 'commands', id: 'cmd5', attributes: {status: 'command.running'}}}}
    })

    await expect(runCloud(cloudConnection, 'sleep(600);', {
      token: 'token',
      fetch,
      interval: 5,
      signal: controller.signal,
    })).rejects.toMatchObject({code: 'aborted', commandId: 'cmd5'})

    // a signal that was already aborted never sends anything at all
    const {fetch: untouched, calls} = fakeFetch(() => ({body: {data: []}}))
    const already = new AbortController()

    already.abort()

    await expect(runCloud(cloudConnection, '1;', {token: 'token', fetch: untouched, signal: already.signal}))
      .rejects.toMatchObject({code: 'aborted'})
    expect(calls).toHaveLength(0)
  })

  test('refuses to run without a token or without an environment', async () => {
    const {fetch, calls} = fakeFetch(() => ({body: {data: []}}))

    await expect(runCloud(cloudConnection, '1;', {fetch})).rejects.toMatchObject({code: 'no_token'})
    await expect(runCloud(
      Object.assign({}, cloudConnection, {cloud_environment_id: ''}),
      '1;',
      {token: 'token', fetch},
    )).rejects.toMatchObject({code: 'validation'})
    expect(calls).toHaveLength(0)
  })

  test('runs a cloud connection through the API, as runCode does for any other', async () => {
    const {fetch, calls} = fakeFetch(method => (method === 'POST'
      ? {body: {data: {type: 'commands', id: 'cmd6'}}}
      : {
          body: {
            data: {
              type: 'commands',
              id: 'cmd6',
              attributes: {
                status: 'command.success',
                exit_code: 0,
                output: outputOf(calls[0].body.command, envelope),
                failure_reason: null,
              },
            },
          },
        }))

    const result = await runCode(cloudConnection, 'return 42;', {token: 'token', fetch, interval: 0})

    expect(calls[0].url).toBe('https://cloud.laravel.com/api/environments/env1/commands')
    expect(result.value).toBe(42)
    expect(result.commandId).toBe('cmd6')
    // the run printed nothing of its own
    expect(result.output).toBe('')
  })

  test('reads the token out of the app\'s secrets file, and tolerates its absence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-cloud-'))

    try {
      // no file at all is no token, not a crash on start
      expect(cloudTokenOf(dir)).toBe('')
      expect(cloudTokenOf('')).toBe('')

      fs.mkdirSync(path.join(dir, 'app'), {recursive: true})
      fs.writeFileSync(path.join(dir, 'app', 'secrets.json'), JSON.stringify({
        someConnectionId: 'ssh-password',
        [CLOUD_SECRET_KEY]: 'the-cloud-token',
      }))

      expect(cloudTokenOf(dir)).toBe('the-cloud-token')

      // a corrupt file is still no token
      fs.writeFileSync(path.join(dir, 'app', 'secrets.json'), '{not json')

      expect(cloudTokenOf(dir)).toBe('')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })
})
