const fs = require('fs')
const os = require('os')
const path = require('path')

const {runRemoteCommand} = require('./remoteCommand')
const {secretsFile} = require('./sshAskpass')

/**
 * A connection to a Laravel Vapor environment, run through the API.
 *
 * Vapor has no terminal either: an environment is a lambda behind an HTTP API,
 * and a command is how something runs inside it — `POST
 * /api/projects/{project}/environments/{environment}/commands`, then `GET
 * /api/commands/{id}` until it reports `finished`. So a vapor connection is a run
 * that travels as a request, exactly as a cloud one is: the envelope wrapRun
 * produces goes out as a `tinker --execute` command, and what the command printed
 * is fed through the same RunResultFilter a pty's output goes through.
 *
 * The differences from Laravel Cloud are the host, the paths, plain JSON instead
 * of a JSON:API envelope, and how a command's output comes back — base64 of a
 * JSON string rather than the text itself. Everything else — the deadline, the
 * stop, the wait between polls, the answer and the failure — is the shared runner
 * in remoteCommand.js, and what is below is the provider that runner drives.
 *
 * The token is never part of a connection: it is one secret for the whole app,
 * kept in the same 0600 file a connection's ssh password is kept in, and it is
 * the MCP server's own data directory that finds it. The Vapor CLI keeps its own
 * token in `~/.laravel-vapor/config.json`, which is where a person's first token
 * comes from when they have not pasted one in yet.
 */

/**
 * The key the Laravel Vapor token is stored under in the secrets file.
 *
 * It starts with `@`, which no connection id does — ids are hex — so the one
 * shared secret and a connection's own secrets cannot collide.
 */
const VAPOR_SECRET_KEY = '@laravel-vapor'

/**
 * How long a command may be.
 *
 * The Vapor API runs the command through a shell and does not document a limit.
 * This one is the size a command is refused at here, so a run that could never
 * fit is answered before anything is sent rather than with a validation error
 * that says nothing about the snippet being the reason. The number itself is
 * unverified against the API.
 */
const VAPOR_COMMAND_LIMIT = 200000

/**
 * The statuses a command ends with.
 *
 * `finished` is the one Vapor documents, and a command that failed still ends
 * with it — the difference is a non-zero `status_code`, not the status. `failed`
 * is read as terminal too: no Vapor command is known to report it, and a run that
 * waits forever on a status nobody will change is worse than one that stops on a
 * name it did not expect.
 */
const VAPOR_DONE_STATUSES = ['finished', 'failed']

/**
 * Where the API is.
 *
 * Read on every call rather than once, because the e2e suite points the app at a
 * fake server by setting the variable after the module is loaded.
 *
 * @return {String}
 */
const vaporApiUrl = () => process.env.TINKR_LARAVEL_VAPOR_URL || 'https://vapor.laravel.com'

/**
 * Whether a connection runs its code on Laravel Vapor.
 *
 * @param {Record<String, any>} connection
 * @return {Boolean}
 */
const isVapor = connection => Boolean(connection && connection.is_vapor)

/**
 * What went wrong with a Laravel Vapor call, in terms the app can act on.
 *
 * `code` is the part a caller branches on — a missing token is not a missing
 * permission, and one is fixed in Preferences while the other is fixed on the
 * token's own page — and the rest is what has to be shown to say which call
 * failed and what state it left behind.
 */
class VaporError extends Error {
  /**
   * @param {String} message
   * @param {String} code one of `unauthorized`, `forbidden`, `not_found`,
   * `validation`, `rate_limited`, `network`, `too_large`, `timeout`, `failed`,
   * `aborted` or `no_token`
   * @param {{status?: Number, commandId?: String, exitCode?: Number|null,
   *   output?: String, cause?: Error}} [extra]
   */
  constructor(message, code, extra = {}) {
    super(message)

    this.name = 'VaporError'
    this.code = code

    for (const key of ['status', 'commandId', 'exitCode', 'output', 'cause']) {
      if (extra[key] !== undefined) {
        this[key] = extra[key]
      }
    }
  }
}

/**
 * The error a status code is.
 *
 * A 403 here names no permission, unlike Laravel Cloud's: Vapor tokens are not
 * scoped, so there is no checkbox to point at and the only thing to say is that
 * this token may not make this call.
 *
 * @param {Number} status
 * @param {Object|null} answered the API's own body, when it had one
 * @return {VaporError}
 */
const errorOf = (status, answered) => {
  const said = answered && typeof answered.message === 'string' ? answered.message : ''
  const extra = {status}

  if (status === 401) {
    return new VaporError(
      'The Laravel Vapor API token is invalid or has expired.',
      'unauthorized',
      extra,
    )
  }

  if (status === 403) {
    return new VaporError(
      'The Laravel Vapor API token is not allowed to make this call.',
      'forbidden',
      extra,
    )
  }

  if (status === 404) {
    return new VaporError(
      said || 'Laravel Vapor answered that this does not exist — it may have been deleted, or the token may see a different team.',
      'not_found',
      extra,
    )
  }

  if (status === 422) {
    return new VaporError(
      said || 'Laravel Vapor rejected the request as invalid.',
      'validation',
      extra,
    )
  }

  if (status === 429) {
    return new VaporError(
      'Laravel Vapor is rate limiting this token. Try again in a moment.',
      'rate_limited',
      extra,
    )
  }

  // anything else — a 500, a gateway that is down — is the API not answering, and
  // a caller can only retry it
  return new VaporError(
    said || `Laravel Vapor answered ${status}.`,
    'network',
    extra,
  )
}

// how long one request may take before it is given up on: a team list, a project
// list or one poll of a run. A network that stalls would otherwise leave a picker
// loading and a check unanswered with no end, and 30 seconds is the wait the app's
// other HTTP client allows as well (see tinkr-main services/ai)
const REQUEST_TIMEOUT = 30000

/**
 * One call against the API.
 *
 * The headers are the plain ones: Vapor answers a bare resource or a list, with
 * no JSON:API wrapper to announce.
 *
 * @param {String} token
 * @param {String} method
 * @param {String} path a path under the API root
 * @param {{body?: Object, signal?: AbortSignal, fetch?: Function}} [options]
 * @return {Promise<any>} the parsed JSON body
 */
const vaporRequest = async (token, method, path, options = {}) => {
  const {body, signal} = options
  // fetch is taken from the caller when it gives one: the tests run the whole
  // protocol against a fake, and no test may reach the network
  const doFetch = options.fetch || ((input, init) => globalThis.fetch(input, init))
  const url = /^https?:\/\//.test(path) ? path : `${String(vaporApiUrl()).replace(/\/+$/, '')}${path}`
  const limit = AbortSignal.timeout(REQUEST_TIMEOUT)
  // the body is read under the same signal, so a response that stops half way is
  // given up on by the same limit as one that never starts
  const bounded = signal ? AbortSignal.any([signal, limit]) : limit

  let response
  let answered = null

  try {
    response = await doFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: bounded,
    })

    try {
      answered = await response.json()
    } catch (e) {
      if (limit.aborted || (signal && signal.aborted)) {
        throw e
      }

      // an empty or non-JSON body is still an answer: a 204 has none, and an
      // error page from a proxy is what the status already said
      answered = null
    }
  } catch (error) {
    // a fetch that rejects because the caller stopped the run is not the network
    // failing, and saying so would send someone looking for a connection problem
    if (signal && signal.aborted) {
      throw new VaporError('The Laravel Vapor request was stopped.', 'aborted', {cause: error})
    }

    if (limit.aborted) {
      throw new VaporError(
        `Laravel Vapor did not answer within ${REQUEST_TIMEOUT / 1000} seconds.`,
        'network',
        {cause: error},
      )
    }

    throw new VaporError(`Could not reach Laravel Vapor: ${error.message}`, 'network', {cause: error})
  }

  if (!response.ok) {
    throw errorOf(response.status, answered)
  }

  return answered
}

/**
 * The list an endpoint answered with.
 *
 * Most of them answer an array. `data` is read as well, because an endpoint that
 * grows an envelope later should not silently become a team with no teams in it.
 *
 * @param {any} answer
 * @return {Array<Object>}
 */
const listOf = answer => {
  if (Array.isArray(answer)) {
    return answer
  }

  return answer && Array.isArray(answer.data) ? answer.data : []
}

/**
 * A team as the picker knows it.
 *
 * @param {Object} item
 * @return {{id: String, name: String}}
 */
const teamOf = item => ({
  id: String(item && item.id !== undefined ? item.id : ''),
  name: (item && item.name) || '',
})

/**
 * A project as the picker knows it.
 *
 * @param {Object} item
 * @return {{id: String, name: String}}
 */
const projectOf = item => ({
  id: String(item && item.id !== undefined ? item.id : ''),
  name: (item && item.name) || '',
})

/**
 * An environment as the app knows it: the name is what a command is sent to, and
 * the domain is what someone opens to see the application.
 *
 * @param {Object} item
 * @return {{id: String, name: String, domain: String}}
 */
const environmentOf = item => ({
  id: String(item && item.id !== undefined ? item.id : ''),
  name: (item && item.name) || '',
  domain: (item && item.vanity_domain) || '',
})

/**
 * The teams a token can see.
 *
 * @param {String} token
 * @param {{signal?: AbortSignal, fetch?: Function}} [options]
 * @return {Promise<Array<{id: String, name: String}>>}
 */
const vaporTeams = async (token, options = {}) => {
  const answer = await vaporRequest(token, 'GET', '/api/teams', options)

  return listOf(answer).map(teamOf)
}

/**
 * The projects of one team.
 *
 * @param {String} token
 * @param {String} teamId
 * @param {{signal?: AbortSignal, fetch?: Function}} [options]
 * @return {Promise<Array<{id: String, name: String}>>}
 */
const vaporProjects = async (token, teamId, options = {}) => {
  const answer = await vaporRequest(
    token,
    'GET',
    `/api/teams/${encodeURIComponent(teamId)}/projects`,
    options,
  )

  return listOf(answer).map(projectOf)
}

/**
 * The environments of one project.
 *
 * @param {String} token
 * @param {String} projectId
 * @param {{signal?: AbortSignal, fetch?: Function}} [options]
 * @return {Promise<Array<{id: String, name: String, domain: String}>>}
 */
const vaporEnvironments = async (token, projectId, options = {}) => {
  const answer = await vaporRequest(
    token,
    'GET',
    `/api/projects/${encodeURIComponent(projectId)}/environments`,
    options,
  )

  return listOf(answer).map(environmentOf)
}

/**
 * The shell command that runs an already-wrapped run inside an environment.
 *
 * Vapor runs the command as `php $ROOT/artisan <command> --no-interaction 2>&1`
 * through a shell, so what is given here is the part after `artisan` — naming
 * `php artisan` again would ask Vapor to run artisan from inside artisan. The
 * wrapper's php travels base64-encoded: base64 has no single quote in its
 * alphabet, so wrapping it in `'…'` is safe in every POSIX shell no matter what
 * the snippet contains.
 *
 * @param {String} code `run.code` from wrapRun
 * @return {String}
 */
const vaporCommand = code => {
  const encoded = Buffer.from(code === undefined || code === null ? '' : String(code), 'utf8').toString('base64')
  const command = `tinker --execute='eval(base64_decode("${encoded}"));'`

  if (command.length > VAPOR_COMMAND_LIMIT) {
    throw new VaporError(
      `This run is ${encoded.length} characters of base64 and ${command.length} as a Laravel Vapor ` +
      `command, and Laravel Vapor accepts commands of at most ${VAPOR_COMMAND_LIMIT} characters.`,
      'too_large',
    )
  }

  return command
}

/**
 * What a command printed, from the `output` its answer carries.
 *
 * Vapor keeps a command's output as base64 of a JSON string `{output, context}`,
 * where `output` is what the command wrote and the context is what Laravel's own
 * run console draws around it. So the two layers come off: the base64 first, then
 * the JSON. A decoded value that is not JSON is taken as the text itself, because
 * a command whose output the API stored unwrapped should still be readable, and a
 * value that is not base64 at all is passed through for the same reason.
 *
 * null is a finished command whose output has not been written yet: the status is
 * stored before the output is, and the runner asks again rather than reading the
 * absence as an empty answer (see remoteCommand's UNPRINTED_RETRIES).
 *
 * @param {any} rawOutput
 * @return {String|null}
 */
const vaporOutputOf = rawOutput => {
  if (rawOutput === null || rawOutput === undefined || typeof rawOutput !== 'string') {
    return null
  }

  // base64 as the API writes it: no whitespace, and a length that decodes to
  // whole bytes. An answer that is neither is taken as the text it already is,
  // because decoding plain text only turns one readable answer into an
  // unreadable one.
  const packed = rawOutput.replace(/\s+/g, '')
  const encoded = packed.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(packed)
  const text = encoded ? Buffer.from(packed, 'base64').toString('utf8') : rawOutput

  // a decode that produced binary was not base64 after all
  if (encoded && (text.includes('\u0000') || text.includes('\uFFFD'))) {
    return rawOutput
  }

  try {
    const decoded = JSON.parse(text)

    if (decoded && typeof decoded === 'object') {
      return typeof decoded.output === 'string' ? decoded.output : ''
    }
  } catch (e) {
    // not JSON: the decoded text is the output
  }

  return text
}

/**
 * The token saved in the app's data directory, or ''.
 *
 * A missing file, a file that is not JSON, a key that is not there: all of them
 * mean the app has no token, which is a thing to say rather than a crash on start.
 * The same file the MCP server reads a connection's ssh password from.
 *
 * @param {String} [dataDir]
 * @return {String}
 */
const vaporTokenOf = dataDir => {
  if (!dataDir) {
    return ''
  }

  try {
    const stored = JSON.parse(fs.readFileSync(secretsFile(dataDir), 'utf8'))
    const token = stored && stored[VAPOR_SECRET_KEY]

    return typeof token === 'string' ? token : ''
  } catch (e) {
    return ''
  }
}

/**
 * The token the Vapor CLI itself saved, and the team it defaults to.
 *
 * `vapor login` writes `~/.laravel-vapor/config.json`, and someone who has used
 * the CLI already has a token there: asking them to make another one before the
 * app can list a single team is a step that says the app does not know where to
 * look. The file is another program's, so everything about it is optional — no
 * file, a token that is not a string, a team that is not there: null.
 *
 * @param {String} [home] the home directory, which the tests set to a temp one
 * @return {{token: String, team: String}|null}
 */
const vaporCliCredentials = (home = os.homedir()) => {
  try {
    const stored = JSON.parse(
      fs.readFileSync(path.join(home, '.laravel-vapor', 'config.json'), 'utf8'),
    )
    const token = stored && typeof stored.token === 'string' ? stored.token : ''

    if (!token) {
      return null
    }

    return {token, team: typeof stored.team === 'string' ? stored.team : ''}
  } catch (e) {
    return null
  }
}

/**
 * The provider a Laravel Vapor environment is.
 *
 * The endpoints, the field names, the status a command ends with and the words a
 * run's messages use — everything the shared runner must not know (see
 * remoteCommand.runRemoteCommand). The token, the project and the environment are
 * closed over here, so a run is handed the API it talks to and nothing else.
 *
 * There is no `download`: Vapor keeps the output in the command's own answer and
 * hands back no URL for the whole of it, so a run has nothing it could have lost.
 *
 * @param {String} token
 * @param {String} projectId
 * @param {String} environmentName
 * @param {{fetch?: Function}} [options]
 * @return {Object} a provider, as remoteCommand documents one
 */
const vaporProvider = (token, projectId, environmentName, options = {}) => ({
  name: 'Laravel Vapor',
  ErrorClass: VaporError,
  commandFor: vaporCommand,
  create: async (command, {signal}) => {
    // the environment is named rather than numbered in this endpoint, which is
    // why the name a connection saved is encoded whole: a name with a space or a
    // slash in it is still one path segment
    const created = await vaporRequest(
      token,
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/environments/${encodeURIComponent(environmentName)}/commands`,
      {body: {command}, signal, fetch: options.fetch},
    )

    // an answer that carries no id gives the run nothing to follow, and the
    // runner is the one that says so
    return created && created.id !== undefined && created.id !== null ? String(created.id) : ''
  },
  poll: async (id, {signal}) => {
    const answer = await vaporRequest(token, 'GET', `/api/commands/${encodeURIComponent(id)}`, {
      signal,
      fetch: options.fetch,
    })
    const attrs = answer || {}
    const status = String(attrs.status || '')

    return {
      done: VAPOR_DONE_STATUSES.includes(status),
      status,
      output: vaporOutputOf(attrs.output),
      // the whole output is in the answer, so nothing of it is missing
      truncated: false,
      outputUrl: null,
      exitCode: attrs.status_code === undefined || attrs.status_code === null
        ? null
        : Number(attrs.status_code),
      // a command that failed says why through its exit code and its output
      failureReason: null,
    }
  },
  truncatedNote: '',
})

/**
 * Run a snippet inside a Laravel Vapor environment.
 *
 * What is here is what a Vapor run needs before there is anything to send — a
 * token, a project and an environment — and the provider those make the run
 * against. The run itself is the shared runner's (see
 * remoteCommand.runRemoteCommand): the deadline, the stop, the polls, the output
 * and the answer are the same for any API that runs commands.
 *
 * The run is one command, and the answer arrives when that command ends: the API
 * has no streaming and no cancel, so a run is created, followed until it reports
 * its status, and given up on locally when it takes too long or the caller stops.
 * Giving up locally does not stop the command by itself: the wrapper the run is
 * written in carries the run's deadline with it (see runResult.deadlineOf), so the
 * php ends itself at the timeout where the environment can arm an alarm, and where
 * it cannot the command keeps running there — which is what the timeout's message
 * says, because a snippet still writing to a production database is not a detail
 * to leave out.
 *
 * @param {Record<String, any>} connection
 * @param {String} code the snippet
 * @param {{token?: String, guard?: String|null, timeout?: Number,
 *   signal?: AbortSignal, fetch?: Function, interval?: Number,
 *   imports?: Object}} [options]
 * @return {Promise<Object>} the same shape a pty run answers with, plus `commandId`
 */
const runVapor = (connection, code, options = {}) => {
  const token = options.token || ''
  const projectId = String((connection && connection.vapor_project_id) || '').trim()
  const environmentName = String((connection && connection.vapor_environment_name) || '').trim()

  if (!token) {
    return Promise.reject(new VaporError(
      'No Laravel Vapor API token is saved. Add one in Tinkr under Preferences, Laravel Vapor.',
      'no_token',
    ))
  }

  if (!projectId || !environmentName) {
    return Promise.reject(new VaporError(
      'This connection names no Laravel Vapor environment, so there is nowhere to run code.',
      'validation',
    ))
  }

  return runRemoteCommand(code, vaporProvider(token, projectId, environmentName, options), {
    guard: options.guard,
    timeout: options.timeout,
    interval: options.interval,
    imports: options.imports,
    signal: options.signal,
  })
}

module.exports = {
  VAPOR_SECRET_KEY,
  VAPOR_COMMAND_LIMIT,
  VaporError,
  vaporApiUrl,
  isVapor,
  vaporRequest,
  vaporTeams,
  vaporProjects,
  vaporEnvironments,
  vaporCommand,
  vaporOutputOf,
  vaporTokenOf,
  vaporCliCredentials,
  runVapor,
}
