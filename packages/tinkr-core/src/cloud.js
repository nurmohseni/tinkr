const fs = require('fs')

const {wrapRun, RunResultFilter} = require('./runResult')
const {secretsFile} = require('./sshAskpass')

/**
 * A connection to an application on Laravel Cloud, run through the API.
 *
 * Laravel Cloud has no terminal to attach to: an environment is a set of
 * containers behind an HTTP API, and the documented way to run something inside
 * one is a command — `POST /environments/{id}/commands`, then `GET /commands/{id}`
 * until it ends. So a cloud connection is not a session, it is a run that travels
 * as a request, and everything below is the HTTP half of the run protocol: the
 * envelope wrapRun produces goes out as a `php artisan tinker --execute` command,
 * and what the command printed is fed through the same RunResultFilter a pty's
 * output goes through, so a cloud run answers exactly as a local one does.
 *
 * The token is never part of a connection: it is one secret for the whole app,
 * kept in the same 0600 file a connection's ssh password is kept in, and it is
 * the MCP server's own data directory that finds it.
 */

/**
 * The key the Laravel Cloud token is stored under in the secrets file.
 *
 * It starts with `@`, which no connection id does — ids are hex — so the one
 * shared secret and a connection's own secrets cannot collide.
 */
const CLOUD_SECRET_KEY = '@laravel-cloud'

/**
 * How long a command may be. Laravel Cloud accepts 1 to 150000 characters, and a
 * run past that is refused before anything is sent rather than answered with a
 * validation error that says nothing about the snippet being the reason.
 */
const CLOUD_COMMAND_LIMIT = 150000

/**
 * Where the API is.
 *
 * Read on every call rather than once, because the e2e suite points the app at a
 * fake server by setting the variable after the module is loaded.
 *
 * @return {String}
 */
const cloudApiUrl = () => process.env.TINKR_LARAVEL_CLOUD_URL || 'https://cloud.laravel.com/api'

/**
 * Whether a connection runs its code on Laravel Cloud.
 *
 * @param {Record<String, any>} connection
 * @return {Boolean}
 */
const isCloud = connection => Boolean(connection && connection.is_cloud)

/**
 * What went wrong with a Laravel Cloud call, in terms the app can act on.
 *
 * `code` is the part a caller branches on — a missing token is not a missing
 * permission, and one is fixed in Preferences while the other is fixed on the
 * token's own page — and the rest is what has to be shown to say which call
 * failed and what state it left behind.
 */
class CloudError extends Error {
  /**
   * @param {String} message
   * @param {String} code one of `unauthorized`, `forbidden`, `not_found`,
   * `validation`, `rate_limited`, `network`, `too_large`, `timeout`, `failed`,
   * `aborted` or `no_token`
   * @param {{status?: Number, commandId?: String, permission?: String,
   *   exitCode?: Number|null, output?: String, cause?: Error}} [extra]
   */
  constructor(message, code, extra = {}) {
    super(message)

    this.name = 'CloudError'
    this.code = code

    for (const key of ['status', 'commandId', 'permission', 'exitCode', 'output', 'cause']) {
      if (extra[key] !== undefined) {
        this[key] = extra[key]
      }
    }
  }
}

/**
 * What a call needs to be allowed to do, for the error that says it is not.
 *
 * Laravel Cloud answers a 403 with no detail at all, and "this token may not do
 * that" leaves someone guessing which of five checkboxes to tick. The permission
 * is derived from the call itself, which is the only thing that knows.
 *
 * @param {String} path
 * @return {String} the permission's name as Laravel Cloud's token page writes it
 */
const permissionOf = path => {
  const clean = String(path || '').split('?')[0]

  // both halves of a command need the same permission: creating one is what the
  // token is allowed to do, and following it is reading back what it created
  if (/\/commands(\/|$)/.test(clean)) {
    return 'Environments: Create environment commands'
  }

  if (/\/environments(\/|$)/.test(clean)) {
    return 'Environments: View environments'
  }

  if (/\/applications(\/|$)/.test(clean)) {
    return 'Applications: View applications'
  }

  return ''
}

/**
 * The error a status code is.
 *
 * @param {Number} status
 * @param {String} path
 * @param {Object|null} answered the API's own body, when it had one
 * @return {CloudError}
 */
const errorOf = (status, path, answered) => {
  const said = answered && typeof answered.message === 'string' ? answered.message : ''
  const extra = {status}

  if (status === 401) {
    return new CloudError(
      'The Laravel Cloud API token is invalid or has expired.',
      'unauthorized',
      extra,
    )
  }

  if (status === 403) {
    const permission = permissionOf(path)

    extra.permission = permission

    return new CloudError(
      permission
        ? `The Laravel Cloud API token is missing the "${permission}" permission.`
        : 'The Laravel Cloud API token is not allowed to make this call.',
      'forbidden',
      extra,
    )
  }

  if (status === 404) {
    return new CloudError(
      said || 'Laravel Cloud answered that this does not exist — it may have been deleted, or the token may see a different organization.',
      'not_found',
      extra,
    )
  }

  if (status === 422) {
    return new CloudError(
      said || 'Laravel Cloud rejected the request as invalid.',
      'validation',
      extra,
    )
  }

  if (status === 429) {
    return new CloudError(
      'Laravel Cloud is rate limiting this token. Try again in a moment.',
      'rate_limited',
      extra,
    )
  }

  // anything else — a 500, a gateway that is down — is the API not answering, and
  // a caller can only retry it
  return new CloudError(
    said || `Laravel Cloud answered ${status}.`,
    'network',
    extra,
  )
}

// how long one request may take before it is given up on: a token check, a list
// of applications or one poll of a run. A network that stalls would otherwise
// leave a picker loading and a check unanswered with no end, and 30 seconds is
// the wait the app's other HTTP client allows as well (see tinkr-main services/ai)
const REQUEST_TIMEOUT = 30000

/**
 * One call against the API.
 *
 * @param {String} token
 * @param {String} method
 * @param {String} path a path under the API root, or a whole URL — `links.next`
 *   carries one, and following it has to keep the host the API answered with
 * @param {{body?: Object, signal?: AbortSignal, fetch?: Function}} [options]
 * @return {Promise<Object|null>} the parsed JSON:API body
 */
const cloudRequest = async (token, method, path, options = {}) => {
  const {body, signal} = options
  // fetch is taken from the caller when it gives one: the tests run the whole
  // protocol against a fake, and no test may reach the network
  const doFetch = options.fetch || ((input, init) => globalThis.fetch(input, init))
  const url = /^https?:\/\//.test(path) ? path : `${String(cloudApiUrl()).replace(/\/+$/, '')}${path}`
  const limit = AbortSignal.timeout(REQUEST_TIMEOUT)
  // the body is read under the same signal, so a response that stops half way
  // is given up on by the same limit as one that never starts
  const bounded = signal ? AbortSignal.any([signal, limit]) : limit

  let response
  let answered = null

  try {
    response = await doFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
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
      throw new CloudError('The Laravel Cloud request was stopped.', 'aborted', {cause: error})
    }

    if (limit.aborted) {
      throw new CloudError(
        `Laravel Cloud did not answer within ${REQUEST_TIMEOUT / 1000} seconds.`,
        'network',
        {cause: error},
      )
    }

    throw new CloudError(`Could not reach Laravel Cloud: ${error.message}`, 'network', {cause: error})
  }

  if (!response.ok) {
    throw errorOf(response.status, path, answered)
  }

  return answered
}

/**
 * @param {Object|null} item a JSON:API resource
 * @return {Object}
 */
const attributesOf = item => (item && item.attributes) || {}

/**
 * @param {Object|null} answer
 * @return {Array<Object>}
 */
const dataOf = answer => (answer && Array.isArray(answer.data) ? answer.data : [])

/**
 * The environments a page carried beside its applications.
 *
 * @param {Object|null} answer
 * @return {Array<Object>}
 */
const includedOf = answer => (answer && Array.isArray(answer.included) ? answer.included : [])
  .filter(one => one && one.type === 'environments')

/**
 * An environment as the app knows it: the names the API keeps, under the names
 * the picker and the connection use.
 *
 * @param {Object} item
 * @return {{id: String, name: String, slug: String, status: String, phpVersion: String, domain: String}}
 */
const environmentOf = item => {
  const attrs = attributesOf(item)

  return {
    id: String(item && item.id !== undefined ? item.id : ''),
    name: attrs.name || '',
    slug: attrs.slug || '',
    status: attrs.status || '',
    phpVersion: attrs.php_major_version || '',
    domain: attrs.vanity_domain || '',
  }
}

/**
 * The applications a token can see, with the environments each one has.
 *
 * Environments come as `included` rather than as a separate call, because one
 * request per application is a picker that spends a minute loading. They are
 * matched through each application's own relationship, so an environment belongs
 * to the application the API says it does.
 *
 * The list is paginated, and one page is not the answer: an organization with
 * more applications than fit is not an organization whose later applications do
 * not exist.
 *
 * @param {String} token
 * @param {{signal?: AbortSignal, fetch?: Function}} [options]
 * @return {Promise<Array<{id: String, name: String, slug: String, region: String, environments: Array<Object>}>>}
 */
const cloudApplications = async (token, options = {}) => {
  const found = []
  const environments = new Map()
  const seen = new Set()
  let next = '/applications?include=environments'

  while (next && !seen.has(next)) {
    seen.add(next)

    const answer = await cloudRequest(token, 'GET', next, options)

    for (const item of includedOf(answer)) {
      environments.set(String(item.id), environmentOf(item))
    }

    for (const item of dataOf(answer)) {
      found.push(item)
    }

    next = answer && answer.links && answer.links.next ? answer.links.next : null
  }

  // the relationships are resolved once every page has been read: a page of
  // applications can name an environment that another page's included holds
  return found.map(item => {
    const attrs = attributesOf(item)
    const relations = item.relationships ? item.relationships.environments : null
    const related = relations && Array.isArray(relations.data) ? relations.data : []

    return {
      id: String(item.id),
      name: attrs.name || '',
      slug: attrs.slug || '',
      region: attrs.region || '',
      environments: related
        .map(one => environments.get(String(one && one.id)))
        .filter(Boolean),
    }
  })
}

/**
 * One environment, by the id a connection saved.
 *
 * @param {String} token
 * @param {String} environmentId
 * @param {{signal?: AbortSignal, fetch?: Function}} [options]
 * @return {Promise<{id: String, name: String, slug: String, status: String, phpVersion: String, domain: String}>}
 */
const cloudEnvironment = async (token, environmentId, options = {}) => {
  const answer = await cloudRequest(
    token,
    'GET',
    `/environments/${encodeURIComponent(environmentId)}`,
    options,
  )

  if (!answer || !answer.data) {
    throw new CloudError('Laravel Cloud did not answer with an environment.', 'not_found')
  }

  return environmentOf(answer.data)
}

/**
 * The shell command that runs an already-wrapped run inside an environment.
 *
 * `tinker --execute` evaluates the expression it is given and prints nothing
 * else, so the command's output is the wrapper's own envelope and nothing of
 * psysh's banner. The wrapper's php travels base64-encoded: base64 has no single
 * quote in its alphabet, so wrapping it in `'…'` is safe in every POSIX shell no
 * matter what the snippet contains.
 *
 * @param {String} code `run.code` from wrapRun
 * @return {String}
 */
const cloudCommand = code => {
  const encoded = Buffer.from(code === undefined || code === null ? '' : String(code), 'utf8').toString('base64')
  const command = `php artisan tinker --execute='eval(base64_decode("${encoded}"));'`

  if (command.length > CLOUD_COMMAND_LIMIT) {
    throw new CloudError(
      `This run is ${encoded.length} characters of base64 and ${command.length} as a Laravel Cloud ` +
      `command, and Laravel Cloud accepts commands of at most ${CLOUD_COMMAND_LIMIT} characters.`,
      'too_large',
    )
  }

  return command
}

/**
 * The last lines of what a command printed, for an error's message.
 *
 * The beginning of a failure is usually the framework booting; the end is the
 * exception, which is the part worth reading.
 *
 * @param {String} output
 * @param {Number} [count]
 * @return {String}
 */
const lastLines = (output, count = 20) => {
  const lines = String(output || '').replace(/\r\n/g, '\n').split('\n')

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
  }

  return lines.slice(-count).join('\n').trim()
}

/**
 * The token saved in the app's data directory, or ''.
 *
 * A missing file, a file that is not JSON, a key that is not there: all of them
 * mean the app has no token, which is a thing to say rather than a crash on
 * start. The same file the MCP server reads a connection's ssh password from.
 *
 * @param {String} [dataDir]
 * @return {String}
 */
const cloudTokenOf = dataDir => {
  if (!dataDir) {
    return ''
  }

  try {
    const stored = JSON.parse(fs.readFileSync(secretsFile(dataDir), 'utf8'))
    const token = stored && stored[CLOUD_SECRET_KEY]

    return typeof token === 'string' ? token : ''
  } catch (e) {
    return ''
  }
}

/**
 * The run's own output, from session.js.
 *
 * Read here rather than at the top because session.js requires this module for
 * the cloud branch of runCode, and one of the two directions has to be resolved
 * when it is used rather than when it is loaded: this one, so the function is
 * taken from a module that has finished loading. Node caches the module, so the
 * require inside is a lookup and not a second load.
 *
 * @param {RunResultFilter} filter
 * @return {String}
 */
const runOutputOf = filter => {
  const session = require('./session')

  return session.runOutput(filter)
}

/**
 * Run a snippet inside a Laravel Cloud environment.
 *
 * The run is one command, and the answer arrives when that command ends: the API
 * has no streaming and no cancel, so a run is created, followed until it reports
 * its status, and given up on locally when it takes too long or the caller stops.
 * Giving up locally does not stop it in Laravel Cloud — nothing can — which is
 * what the timeout's message says, because a snippet still writing to a
 * production database is not a detail to leave out.
 *
 * @param {Record<String, any>} connection
 * @param {String} code the snippet
 * @param {{token?: String, guard?: String|null, timeout?: Number,
 *   signal?: AbortSignal, fetch?: Function, interval?: Number,
 *   imports?: Object}} [options]
 * @return {Promise<Object>} the same shape a pty run answers with, plus `commandId`
 */
const runCloud = (connection, code, options = {}) => {
  const {guard = null, timeout = 30000, interval = 1000, imports = {}} = options
  const token = options.token || ''
  const callerSignal = options.signal
  const environmentId = String((connection && connection.cloud_environment_id) || '').trim()

  if (!token) {
    return Promise.reject(new CloudError(
      'No Laravel Cloud API token is saved. Add one in Tinkr under Preferences, Laravel Cloud.',
      'no_token',
    ))
  }

  if (!environmentId) {
    return Promise.reject(new CloudError(
      'This connection names no Laravel Cloud environment, so there is nowhere to run code.',
      'validation',
    ))
  }

  const run = wrapRun(code, imports, guard)
  const filter = new RunResultFilter(run.marker, run.start)
  let command

  try {
    // the command is built before anything is sent: a run too large for the API
    // fails here, instead of spending a command to be told it was too large
    command = cloudCommand(run.code)
  } catch (error) {
    return Promise.reject(error)
  }

  return new Promise((resolve, reject) => {
    // every fetch and every wait listens to this, and settling aborts it: a run
    // that timed out or was stopped must not go on polling in the background
    const stop = new AbortController()
    let settled = false
    let commandId = null
    let timer = null

    const settle = (error, result) => {
      if (settled) {
        return
      }

      settled = true

      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      if (callerSignal) {
        callerSignal.removeEventListener('abort', aborted)
      }

      stop.abort()

      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }

    const aborted = () => settle(new CloudError(
      'The run was stopped.' +
      (commandId ? ` Laravel Cloud keeps running command ${commandId} until it ends.` : ''),
      'aborted',
      {commandId},
    ))

    if (callerSignal) {
      if (callerSignal.aborted) {
        aborted()

        return
      }

      callerSignal.addEventListener('abort', aborted, {once: true})
    }

    if (timeout > 0) {
      timer = setTimeout(() => settle(new CloudError(
        `The run did not answer within ${timeout}ms.` +
        (commandId
          ? ` Laravel Cloud keeps running command ${commandId} until it ends.`
          : ' Laravel Cloud keeps running whatever it started until it ends.'),
        'timeout',
        {commandId},
      )), timeout)
    }

    const request = (method, path, body) => cloudRequest(token, method, path, {
      body,
      signal: stop.signal,
      fetch: options.fetch,
    })

    /**
     * @param {Number} ms
     * @return {Promise<void>} resolves when the interval is over, rejects when
     * the run settles first
     */
    const wait = ms => new Promise((resolve, reject) => {
      if (stop.signal.aborted) {
        reject(new CloudError('The run was stopped.', 'aborted'))

        return
      }

      const cancel = () => {
        clearTimeout(intervalTimer)
        reject(new CloudError('The run was stopped.', 'aborted'))
      }

      const intervalTimer = setTimeout(() => {
        stop.signal.removeEventListener('abort', cancel)
        resolve()
      }, ms)

      stop.signal.addEventListener('abort', cancel, {once: true})
    })

    const work = async () => {
      // the command is non-interactive and runs in the application's root, so
      // `php artisan tinker` is found without a working directory to set
      const created = await request(
        'POST',
        `/environments/${encodeURIComponent(environmentId)}/commands`,
        {command},
      )
      const id = created && created.data && created.data.id !== undefined ? String(created.data.id) : ''

      if (!id) {
        throw new CloudError('Laravel Cloud did not answer with a command to follow.', 'failed')
      }

      commandId = id

      // the run is followed until it says how it ended. `pending`,
      // `command.created` and `command.running` are all "not yet", and nothing
      // else is ever the answer
      for (;;) {
        if (settled) {
          // a timeout or a stop already answered this run: the poll ends here
          // rather than outliving the promise it was answering
          throw new CloudError('The run was stopped.', 'aborted')
        }

        const answer = await request('GET', `/commands/${encodeURIComponent(id)}`)
        const attrs = attributesOf(answer && answer.data)
        const status = String(attrs.status || '')

        if (status === 'command.success' || status === 'command.failure') {
          return attrs
        }

        await wait(interval)
      }
    }

    work().then(attrs => {
      const output = typeof attrs.output === 'string' ? attrs.output : ''
      // the whole output goes in at once: the API has no chunks, and the filter
      // reads a complete string exactly as it reads a session's stream
      const {result} = filter.push(output ? `${output}\n` : '')

      if (!result) {
        const reason = attrs.failure_reason ||
          lastLines(output) ||
          `Laravel Cloud reported ${attrs.status || 'no status'} and printed nothing.`
        const exitCode = attrs.exit_code === undefined ? null : attrs.exit_code
        const said = exitCode === null || exitCode === undefined
          ? reason
          : `${reason}\n\nThe command exited with code ${exitCode}.`

        throw new CloudError(said, 'failed', {commandId, exitCode, output: runOutputOf(filter)})
      }

      settle(null, Object.assign({}, result, {output: runOutputOf(filter), commandId}))
    }).catch(error => settle(error))
  })
}

module.exports = {
  CLOUD_SECRET_KEY,
  CLOUD_COMMAND_LIMIT,
  CloudError,
  cloudApiUrl,
  isCloud,
  cloudRequest,
  cloudApplications,
  cloudEnvironment,
  cloudCommand,
  runCloud,
  cloudTokenOf,
}
