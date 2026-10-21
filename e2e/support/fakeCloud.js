const http = require('http')
const {spawn} = require('child_process')

const {fixture} = require('./tinkr')

/**
 * A Laravel Cloud API that answers the four calls the app makes, on loopback.
 *
 * The app's cloud transport is the real one — real fetch, real JSON:API reading,
 * real polling — and what it talks to is this: a server that speaks the same
 * envelope and runs a command the way the platform does, in an application's
 * own directory. So a run in the suite is a real php process doing real work;
 * the only thing pretending is the network in between.
 *
 * What it answers:
 *
 * - `GET /applications?include=environments`, paginated through `links.next`:
 *   the applications are served in two pages, because one page is not the
 *   answer and the app has to follow the link to see the last of them;
 * - `GET /environments/{id}`;
 * - `POST /environments/{id}/commands`, which starts the posted shell command in
 *   the fixture project and answers a command resource whose status goes
 *   `pending` → `command.running` → `command.success` or `command.failure`;
 * - `GET /commands/{id}`.
 *
 * The token is checked on every call the way the platform checks it, and any
 * other failure can be forced for the calls a test names.
 *
 * @param {Object} [options]
 * @param {String} [options.token] the one bearer token that is accepted
 * @param {Array<{id: String, name: String, slug: String, region: String,
 *   environments: Array<{id: String, name: String, slug: String,
 *   status: String, phpVersion: String, domain: String}>}>} [options.applications]
 * @param {Object|null} [options.fail] `{status, path}`: a RegExp on the path and
 *   the status to answer it with, for a token that is valid and not allowed to
 *   do one thing
 * @param {String} [options.dir] the directory a command runs in
 * @return {Promise<{url: String, requests: Array<Object>,
 *   commands: Array<Object>, close: Function}>}
 */
const startFakeCloud = async ({
  token = 'fixture-cloud-token',
  applications = [],
  fail = null,
  dir = fixture,
} = {}) => {
  // every call, in the order it arrived: what a test asserts about the traffic
  // the app made, as opposed to what it says it made
  const requests = []
  // the commands, as resources: the test reads their status the way the app does
  const commands = []
  const children = new Set()

  const pageSize = Math.max(1, Math.ceil(applications.length / 2))

  const environmentOf = (id) => {
    for (const application of applications) {
      for (const environment of application.environments || []) {
        if (environment.id === id) {
          return {application, environment}
        }
      }
    }

    return null
  }

  const resourceOf = item => ({
    type: 'environments',
    id: item.id,
    attributes: {
      name: item.name,
      slug: item.slug,
      status: item.status,
      php_major_version: item.phpVersion,
      vanity_domain: item.domain,
    },
  })

  const applicationOf = item => ({
    type: 'applications',
    id: item.id,
    attributes: {name: item.name, slug: item.slug, region: item.region},
    relationships: {
      environments: {
        data: (item.environments || []).map(environment => ({type: 'environments', id: environment.id})),
      },
    },
  })

  const commandOf = command => ({
    type: 'commands',
    id: command.id,
    attributes: {
      command: command.command,
      output: command.output,
      status: command.status,
      exit_code: command.exit_code,
      failure_reason: command.failure_reason,
    },
  })

  /**
   * Run one command the way an environment does: a shell in the application's
   * directory, and its whole output kept for the poll to answer with.
   */
  const run = command => {
    // the platform boots the instance and starts the command: between the
    // creation and the run there is a moment, and it is a status of its own
    setTimeout(() => {
      if (command.done) {
        return
      }

      command.status = 'command.running'

      const child = spawn('sh', ['-c', command.command], {cwd: dir})
      let out = ''
      let err = ''

      children.add(child)

      child.stdout.on('data', chunk => { out += chunk })
      child.stderr.on('data', chunk => { err += chunk })

      child.on('close', code => {
        children.delete(child)

        if (command.done) {
          return
        }

        const exitCode = typeof code === 'number' ? code : 1

        command.output = out + err
        command.exit_code = exitCode
        command.status = exitCode === 0 ? 'command.success' : 'command.failure'

        if (exitCode !== 0) {
          command.failure_reason = `The command exited with code ${exitCode}.`
        }
      })
    }, 20)
  }

  const answer = (response, status, payload) => {
    response.writeHead(status, {'content-type': 'application/vnd.api+json'})
    response.end(payload === undefined ? '' : JSON.stringify(payload))
  }

  /**
   * @param {http.IncomingMessage} request
   * @param {URL} url
   * @param {Object|null} body the request's json body, when it had one
   * @return {{status: Number, payload: Object}}
   */
  const route = (request, url, body) => {
    const method = request.method
    const path = url.pathname

    if (fail && fail.path.test(path)) {
      return {status: fail.status, payload: {message: 'This action is unauthorized.'}}
    }

    if (method === 'GET' && path === '/applications') {
      const page = Number(url.searchParams.get('page') || 1)
      const from = (page - 1) * pageSize
      const slice = applications.slice(from, from + pageSize)
      const nextPage = from + pageSize < applications.length ? page + 1 : null

      return {
        status: 200,
        payload: {
          data: slice.map(applicationOf),
          included: slice.flatMap(item => (item.environments || []).map(resourceOf)),
          links: {
            // the platform answers with a whole URL, and the app follows it as
            // one: the host is the one the call was made to, port and all
            next: nextPage
              ? `http://${request.headers.host}/applications?include=environments&page=${nextPage}`
              : null,
          },
        },
      }
    }

    const environmentMatch = path.match(/^\/environments\/([^/]+)$/)

    if (method === 'GET' && environmentMatch) {
      const found = environmentOf(decodeURIComponent(environmentMatch[1]))

      if (!found) {
        return {status: 404, payload: {message: 'Environment not found.'}}
      }

      return {status: 200, payload: {data: resourceOf(found.environment)}}
    }

    const createMatch = path.match(/^\/environments\/([^/]+)\/commands$/)

    if (method === 'POST' && createMatch) {
      const found = environmentOf(decodeURIComponent(createMatch[1]))

      if (!found) {
        return {status: 404, payload: {message: 'Environment not found.'}}
      }

      const command = body

      if (!command || typeof command.command !== 'string' || command.command === '') {
        return {status: 422, payload: {message: 'The command field is required.'}}
      }

      const record = {
        id: `cmd-${commands.length + 1}`,
        command: command.command,
        output: null,
        status: 'pending',
        exit_code: null,
        failure_reason: null,
        done: false,
      }

      commands.push(record)
      run(record)

      return {status: 201, payload: {data: commandOf(record)}}
    }

    const commandMatch = path.match(/^\/commands\/([^/]+)$/)

    if (method === 'GET' && commandMatch) {
      const id = decodeURIComponent(commandMatch[1])
      const record = commands.find(one => one.id === id)

      if (!record) {
        return {status: 404, payload: {message: 'Command not found.'}}
      }

      return {status: 200, payload: {data: commandOf(record)}}
    }

    return {status: 404, payload: {message: 'Not found.'}}
  }

  const server = http.createServer((request, response) => {
    let body = ''

    request.on('data', chunk => { body += chunk })

    request.on('end', () => {
      const url = new URL(request.url, 'http://127.0.0.1')

      let parsed = null

      try {
        parsed = body === '' ? null : JSON.parse(body)
      } catch (e) {
        parsed = null
      }

      requests.push({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        authorization: request.headers.authorization || '',
        body: parsed,
      })

      if (request.headers.authorization !== `Bearer ${token}`) {
        answer(response, 401, {message: 'Unauthenticated.'})

        return
      }

      const answered = route(request, url, parsed)

      answer(response, answered.status, answered.payload)
    })
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  const {port} = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    commands,
    close: () => new Promise(resolve => {
      // a command still running is one the app gave up on locally: the platform
      // would keep it, and the test's server does not outlive the test
      for (const child of children) {
        child.kill('SIGKILL')
      }

      children.clear()

      server.closeAllConnections?.()
      server.close(resolve)
    }),
  }
}

module.exports = {startFakeCloud}
