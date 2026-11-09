const http = require('http')
const path = require('path')
const {spawn} = require('child_process')

const {fixture} = require('./tinkr')

/**
 * A Laravel Vapor API that answers the five calls the app makes, on loopback.
 *
 * The app's Vapor transport is the real one — real fetch, real plain JSON, real
 * polling — and what it talks to is this: a server that speaks the same shapes
 * and runs a command the way an environment does, with `php` in the project's
 * own directory. So a run in the suite is a real process doing real work; the
 * only thing pretending is the network in between.
 *
 * What it answers:
 *
 * - `GET /api/teams`;
 * - `GET /api/teams/{team}/projects`;
 * - `GET /api/projects/{project}/environments`, each with its `vanity_domain`;
 * - `POST /api/projects/{project}/environments/{name}/commands`, which starts
 *   the posted command the way Vapor does — `php <project>/artisan <command>
 *   --no-interaction 2>&1` — and answers a command whose status goes `pending`
 *   → `running` → `finished` with the exit code it ended with;
 * - `GET /api/commands/{id}`.
 *
 * An environment is named rather than numbered in that path, so a name is one
 * segment of it and the app encodes it as one; the fake decodes it back.
 *
 * A command's output comes back the way Vapor keeps it: base64 of a JSON string
 * carrying `output` and the `context` it was run in. Vapor's own runner drops the
 * log-shaped lines a Laravel command can print, so this keeps them out too — a
 * line that carries both `{"message":` and `"level":` is not part of the answer.
 *
 * The token is checked on every call, and any other failure can be forced for
 * the calls a test names.
 *
 * @param {Object} [options]
 * @param {String} [options.token] the one bearer token that is accepted
 * @param {Array<{id: String, name: String, projects: Array<{id: String,
 *   name: String, environments: Array<{id: String, name: String,
 *   vanityDomain: String}>}>}>} [options.teams]
 * @param {Object|null} [options.fail] `{status, path}`: a RegExp on the path and
 *   the status to answer it with, for a token that is valid and not allowed to
 *   do one thing
 * @param {String} [options.dir] the directory a command runs in
 * @return {Promise<{url: String, requests: Array<Object>,
 *   commands: Array<Object>, close: Function}>}
 */
const startFakeVapor = async ({
  token = 'fixture-vapor-token',
  teams = [],
  fail = null,
  dir = fixture,
} = {}) => {
  // every call, in the order it arrived: what a test asserts about the traffic
  // the app made, as opposed to what it says it made
  const requests = []
  // the commands, as the fake holds them: the test reads their status and what
  // they printed the way the app does, one poll at a time
  const commands = []
  const children = new Set()

  const projectOf = id => {
    for (const team of teams) {
      for (const project of team.projects || []) {
        if (project.id === id) {
          return project
        }
      }
    }

    return null
  }

  const listedTeam = team => ({id: team.id, name: team.name})

  const listedProject = project => ({id: project.id, name: project.name})

  const listedEnvironment = environment => ({
    id: environment.id,
    name: environment.name,
    vanity_domain: environment.vanityDomain || '',
  })

  /**
   * What a command printed, minus the lines Vapor's runner does not keep.
   *
   * A Laravel command can print its log as JSON, and Vapor reads those lines
   * out of the output it stores rather than handing them back as the answer.
   *
   * @param {String} text
   * @return {String}
   */
  const quiet = text => String(text)
    .split('\n')
    .filter(line => !(line.includes('{"message":') && line.includes('"level":')))
    .join('\n')

  /**
   * Run one command the way an environment does: `php artisan` with the command
   * after it, in the project's directory, with the exit code kept for the poll.
   */
  const run = command => {
    // the environment boots and starts the command: between the creation and
    // the run there is a moment, and it is a status of its own
    setTimeout(() => {
      if (command.done) {
        return
      }

      command.status = 'running'

      const shell = `php ${path.join(dir, 'artisan')} ${command.command} --no-interaction 2>&1`
      const child = spawn('sh', ['-c', shell], {cwd: dir})
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

        // a command that failed still ends `finished`: the exit code is what
        // says it failed, not the status
        command.output = quiet(out + err)
        command.status_code = typeof code === 'number' ? code : 1
        command.status = 'finished'
        command.done = true
      })
    }, 20)
  }

  const answer = (response, status, payload) => {
    response.writeHead(status, {'content-type': 'application/json'})
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
    const pathname = url.pathname

    if (fail && fail.path.test(pathname)) {
      // the answer a status carries in words: a token that may not make a call
      // is told so, and a server that broke is not blamed on the token
      const message = fail.status >= 500
        ? 'The server could not handle this request.'
        : 'This action is unauthorized.'

      return {status: fail.status, payload: {message}}
    }

    if (method === 'GET' && pathname === '/api/teams') {
      return {status: 200, payload: teams.map(listedTeam)}
    }

    const projectsMatch = pathname.match(/^\/api\/teams\/([^/]+)\/projects$/)

    if (method === 'GET' && projectsMatch) {
      const team = teams.find(one => one.id === decodeURIComponent(projectsMatch[1]))

      if (!team) {
        return {status: 404, payload: {message: 'Team not found.'}}
      }

      return {status: 200, payload: (team.projects || []).map(listedProject)}
    }

    const environmentsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/environments$/)

    if (method === 'GET' && environmentsMatch) {
      const project = projectOf(decodeURIComponent(environmentsMatch[1]))

      if (!project) {
        return {status: 404, payload: {message: 'Project not found.'}}
      }

      return {status: 200, payload: (project.environments || []).map(listedEnvironment)}
    }

    const createMatch = pathname.match(/^\/api\/projects\/([^/]+)\/environments\/([^/]+)\/commands$/)

    if (method === 'POST' && createMatch) {
      const project = projectOf(decodeURIComponent(createMatch[1]))

      if (!project) {
        return {status: 404, payload: {message: 'Project not found.'}}
      }

      const name = decodeURIComponent(createMatch[2])
      const environment = (project.environments || []).find(one => one.name === name)

      if (!environment) {
        return {status: 404, payload: {message: 'Environment not found.'}}
      }

      const command = body

      if (!command || typeof command.command !== 'string' || command.command === '') {
        return {status: 422, payload: {message: 'The command field is required.'}}
      }

      const record = {
        id: `cmd-${commands.length + 1}`,
        environment: environment.name,
        command: command.command,
        output: null,
        status: 'pending',
        status_code: null,
        done: false,
      }

      commands.push(record)
      run(record)

      return {status: 201, payload: {id: record.id, status: record.status}}
    }

    const commandMatch = pathname.match(/^\/api\/commands\/([^/]+)$/)

    if (method === 'GET' && commandMatch) {
      const id = decodeURIComponent(commandMatch[1])
      const record = commands.find(one => one.id === id)

      if (!record) {
        return {status: 404, payload: {message: 'Command not found.'}}
      }

      if (!record.done) {
        return {status: 200, payload: {id: record.id, status: record.status}}
      }

      return {
        status: 200,
        payload: {
          id: record.id,
          status: record.status,
          status_code: record.status_code,
          // Vapor keeps the output as base64 of a JSON string: what the command
          // wrote, with the context it was given in beside it
          output: Buffer.from(JSON.stringify({
            output: record.output,
            context: {command: `php artisan ${record.command}`},
          }), 'utf8').toString('base64'),
        },
      }
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
      // a command still running is one the app gave up on locally: Vapor would
      // keep it, and the test's server does not outlive the test
      for (const child of children) {
        child.kill('SIGKILL')
      }

      children.clear()

      server.closeAllConnections?.()
      server.close(resolve)
    }),
  }
}

module.exports = {startFakeVapor}
