const fs = require('fs')
const os = require('os')
const path = require('path')

const {makeAppDir, removeAppDir, connection} = require('../__fixtures__/app')
const app = require('../app')
const target = require('../target')
const {createServer, render, connectionInfo} = require('../server')

// the run tools refuse a directory that is not there, because the session would
// otherwise boot in the home directory, so the project a run names exists
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-project-'))

afterAll(() => fs.rmSync(project, {recursive: true, force: true}))

const envelope = (fields = {}) => Object.assign({
  blocks: [{line: 1, value: 3, error: null}],
  value: 3,
  error: null,
  output: '',
  imported: {},
}, fields)

const opened = ({run = async () => envelope(), at, connection: named, command, dataDir, timeout, journal = null} = {}) => {
  const resolved = target.resolve({connection: named, at, command, dataDir})

  return {resolved, server: createServer({target: resolved, version: '0.1.0', timeout, run, journal})}
}

describe('the tools', () => {
  let dir

  afterEach(() => {
    if (dir) {
      removeAppDir(dir)
      dir = null
    }
  })

  test('runs the code in the project the server was started on', async () => {
    const seen = []
    const {server} = opened({
      at: project,
      run: async (connection, code, options) => {
        seen.push({connection, code, options})

        return envelope()
      },
    })

    const answer = await server.call('tinkr_run_php', {code: '$orders = 3;'})

    expect(seen[0].connection.path).toBe(path.resolve(project))
    expect(seen[0].code).toBe('$orders = 3;')
    expect(seen[0].options.timeout).toBe(60000)
    expect(answer.content[0].text).toBe('Line 1: 3')
    expect(answer.structuredContent.value).toBe(3)
    expect(answer.isError).toBe(false)
  })

  test('answers with every statement that answered, and what the run printed', () => {
    expect(render({
      blocks: [
        {line: 1, value: {id: 1, name: 'Ada'}, error: null},
        {line: 2, value: null, error: null},
        {line: 3, value: null, error: {class: 'RuntimeException', message: 'boom'}},
      ],
      value: null,
      error: {class: 'RuntimeException', message: 'boom'},
      output: 'hello\n',
    })).toBe([
      'Line 1: {',
      '  "id": 1,',
      '  "name": "Ada"',
      '}',
      'Line 3: threw RuntimeException: boom',
      '',
      'printed:',
      'hello',
    ].join('\n'))
  })

  test('says so when a run returned nothing and printed nothing', () => {
    expect(render({blocks: [], value: null, error: null, output: ''})).toBe('no value returned')
  })

  test('cuts what a run printed rather than handing a model a megabyte of it', () => {
    const text = render({blocks: [], value: null, error: null, output: 'x'.repeat(200000)})

    expect(text).toMatch(/characters were cut$/)
    expect(text.length).toBeLessThan(100100)
  })

  test('writes what a dry run changed, and what it could not describe', () => {
    const text = render(envelope({
      transaction: {
        mode: 'rollback',
        armed: true,
        connection: 'mysql',
        statements: 3,
        outcome: 'rolledBack',
        error: null,
        unguarded: {},
        changes: [
          {connection: 'mysql', table: 'orders', key: {id: 1}, op: 'updated', before: {paid: 1}, after: {paid: 0}},
          {connection: 'mysql', table: 'orders', key: {id: 4}, op: 'created', before: null, after: {customer: 'Mira', total: 9.5}},
          {connection: 'mysql', table: 'orders', key: {id: 2}, op: 'deleted', before: {customer: 'Grace'}, after: null},
        ],
        changesTotal: 3,
        undiffed: {count: 1, sample: ['update orders set paid = ? where id = 9']},
      },
    }), 'rollback')

    expect(text).toContain('Dry run: rolled back on mysql. 3 statements sent in the transaction, none of it kept.')
    // one line per row, read from the side of the change it has
    expect(text).toContain('Changes: 3 rows.')
    expect(text).toContain('  updated orders id=1: paid 1 → 0')
    expect(text).toContain('  created orders id=4: customer "Mira", total 9.5')
    expect(text).toContain('  deleted orders id=2: customer "Grace"')
    // the writes nothing spoke for are said, with the statement as it was sent
    expect(text).toContain('Not diffed: 1 write inside the dry run could not be described as rows.')
    expect(text).toContain('  update orders set paid = ? where id = 9')
  })

  test('says how much of a cut change list it is showing', () => {
    const text = render(envelope({
      transaction: {
        mode: 'rollback',
        armed: true,
        connection: 'mysql',
        statements: 60,
        outcome: 'rolledBack',
        error: null,
        changes: [{connection: 'mysql', table: 'orders', key: {id: 1}, op: 'updated', before: {paid: 1}, after: {paid: 0}}],
        changesTotal: 60,
        undiffed: {count: 0, sample: []},
      },
    }), 'rollback')

    expect(text).toContain('Changes: 60 rows (the first 1 are in the answer).')
  })

  test('a guarded run that changed nothing says nothing about changes', () => {
    const text = render(envelope({
      transaction: {
        mode: 'rollback',
        armed: true,
        connection: 'mysql',
        statements: 1,
        outcome: 'rolledBack',
        error: null,
        changes: [],
        changesTotal: 0,
        undiffed: {count: 0, sample: []},
      },
    }), 'rollback')

    expect(text).not.toContain('Changes:')
    expect(text).not.toContain('Not diffed:')
  })

  test('a snippet that threw is an answer, not a tool that failed', async () => {
    const {server} = opened({
      at: project,
      run: async () => envelope({
        value: null,
        error: {class: 'RuntimeException', message: 'boom'},
        blocks: [{line: 2, value: null, error: {class: 'RuntimeException', message: 'boom'}}],
      }),
    })

    const answer = await server.call('tinkr_run_php', {code: 'throw new RuntimeException(\'boom\');'})

    expect(answer.isError).toBe(false)
    expect(answer.content[0].text).toBe('Line 2: threw RuntimeException: boom')
    expect(answer.structuredContent.error).toEqual({class: 'RuntimeException', message: 'boom'})
  })

  test('says where an error was thrown, in the text and the structured answer', async () => {
    const error = {
      class: 'QueryException',
      message: 'SQLSTATE[HY000]: syntax error',
      line: null,
      file: 'app/Models/User.php',
      fileLine: 42,
      trace: [
        {file: 'vendor/laravel/framework/src/Illuminate/Database/Connection.php', line: 760, class: null, function: 'runQueryCallback', snippet: false},
        {file: null, line: 3, class: 'Illuminate\\Database\\Query\\Builder', function: 'get', snippet: true},
      ],
    }
    const block = {line: 3, value: null, error: error}
    const {server} = opened({
      at: project,
      run: async () => envelope({value: null, error: error, blocks: [block]}),
    })

    const answer = await server.call('tinkr_run_php', {code: 'User::query()->whereRaw(\'nope(\')->get();'})

    // the statement's line first, then the file the throw came from and the
    // frames, with the snippet's own frame named as a line of the snippet
    expect(answer.content[0].text).toBe([
      'Line 3: threw QueryException: SQLSTATE[HY000]: syntax error',
      '  at app/Models/User.php:42',
      '  trace:',
      '    #0 vendor/laravel/framework/src/Illuminate/Database/Connection.php:760 runQueryCallback',
      '    #1 snippet line 3 Illuminate\\Database\\Query\\Builder->get',
    ].join('\n'))
    // the same facts, as data: nothing of them is text a caller has to parse
    expect(answer.structuredContent.error).toEqual(error)
    expect(answer.structuredContent.blocks[0].error.trace).toHaveLength(2)
  })

  test('a run that never came back is a tool that failed', async () => {
    const {server} = opened({
      at: project,
      run: async () => {
        throw new Error('the session did not answer within 60000ms')
      },
    })

    const answer = await server.call('tinkr_run_php', {code: 'sleep(60);'})

    expect(answer.isError).toBe(true)
    expect(answer.content[0].text).toBe('the session did not answer within 60000ms')
  })

  // the bug this waits against: a command that never booted was answered with a
  // timeout, and what the command printed — the one thing that says what to fix
  // — was thrown away
  test('a command that never booted answers with what it printed', async () => {
    const {server} = opened({
      at: project,
      run: async () => {
        const error = new Error('the session\'s command exited before it was ready (exit status 1): Could not open input file: artisan')

        error.name = 'SessionError'
        error.output = 'Could not open input file: artisan'

        throw error
      },
    })

    const answer = await server.call('tinkr_run_php', {code: '1;'})

    expect(answer.isError).toBe(true)
    expect(answer.content[0].text).toContain('Could not open input file: artisan')
    expect(answer.content[0].text).toContain('exit status 1')
    expect(answer.structuredContent.error.class).toBe('SessionError')
    expect(answer.structuredContent.output).toBe('Could not open input file: artisan')
  })

  test('waits as long as the caller asks, within reason', async () => {
    const seen = []
    const {server} = opened({
      at: project,
      run: async (project, code, options) => {
        seen.push(options.timeout)

        return envelope()
      },
    })

    await server.call('tinkr_run_php', {code: '1;', timeout_ms: 500})
    await server.call('tinkr_run_php', {code: '1;', timeout_ms: 900000})
    await server.call('tinkr_run_php', {code: '1;'})

    expect(seen).toEqual([1000, 600000, 60000])
  })

  test('knows which of the two run tools a connection belongs to', async () => {
    dir = makeAppDir({
      connections: {
        local: connection({id: 'local', name: 'Local', path: project}),
        production: connection({
          id: 'production',
          name: 'Production',
          is_over_ssh: true,
          ssh_server: 'example.com',
          ssh_user: 'deploy',
        }),
      },
    })

    const {server} = opened({dataDir: dir, connection: 'production', run: async () => envelope()})

    // the server was started on the ssh connection
    const here = await server.call('tinkr_run_php', {code: '1;'})

    expect(here.isError).toBe(true)
    expect(here.content[0].text).toMatch(/tinkr_run_php_over_ssh/)

    // and a connection named on the call is the one that runs
    const remote = await server.call('tinkr_run_php_over_ssh', {connection: 'local', code: '1;'})

    expect(remote.isError).toBe(true)
    expect(remote.content[0].text).toMatch(/runs on this machine/)

    const there = await server.call('tinkr_run_php_over_ssh', {connection: 'production', code: '1;'})

    expect(there.isError).toBe(false)
  })

  test('refuses a production run by default, and names the setting', async () => {
    dir = makeAppDir({
      connections: {live: connection({id: 'live', name: 'Live Shop', tag: 'production', path: project})},
    })

    const ran = []
    // started on that very connection, which no longer lets a run through
    const {server} = opened({
      dataDir: dir,
      connection: 'live',
      run: async (one, code) => {
        ran.push(code)

        return envelope()
      },
    })

    const refused = await server.call('tinkr_run_php', {code: '1;'})

    expect(refused.isError).toBe(true)
    expect(refused.content[0].text).toMatch(/Live Shop is tagged production/)
    expect(refused.content[0].text).toMatch(/Settings → MCP/)
    expect(refused.content[0].text).toMatch(/refuse/)
    expect(ran).toEqual([])
  })

  test('follows the production mode between runs, without a restart', async () => {
    dir = makeAppDir({
      connections: {live: connection({id: 'live', name: 'Live Shop', tag: 'production', path: project})},
    })

    const guards = []
    const {server} = opened({
      dataDir: dir,
      connection: 'live',
      run: async (one, code, options) => {
        guards.push(options.guard)

        return envelope()
      },
    })
    const mode = value => fs.writeFileSync(app.configFile(dir), JSON.stringify({mcp_production: value}))

    // nothing set, and anything that is not one of the three, is refuse
    expect((await server.call('tinkr_run_php', {code: '1;'})).isError).toBe(true)

    mode('guarded')

    const guarded = await server.call('tinkr_run_php', {code: '2;'})

    expect(guarded.isError).toBe(false)
    expect(guarded.structuredContent.production).toEqual({mode: 'guarded', source: 'settings', guard_forced: true})

    mode('allow')

    const allowed = await server.call('tinkr_run_php', {code: '3;'})

    expect(allowed.isError).toBe(false)
    expect(allowed.structuredContent.production).toEqual({mode: 'allow', source: 'settings', guard_forced: false})

    // only the three words are modes; a file edited by hand is a refusal
    mode('yes')

    expect((await server.call('tinkr_run_php', {code: '4;'})).isError).toBe(true)
    expect(guards).toEqual(['sandbox', null])
  })

  test('forces a sandbox in guarded mode, whatever the call asked for', async () => {
    dir = makeAppDir({
      config: {mcp_production: 'guarded'},
      connections: {live: connection({id: 'live', name: 'Live Shop', tag: 'production', path: project})},
    })

    const guards = []
    const {server} = opened({
      dataDir: dir,
      connection: 'live',
      run: async (one, code, options) => {
        guards.push(options.guard)

        return envelope({
          transaction: {mode: 'rollback', armed: true, outcome: 'rolledBack', statements: 1, connection: 'live', error: null},
          sandbox: {channels: {}, sent: [], not_sandboxed: []},
        })
      },
    })

    // nothing asked for, and a plain dry run, are both upgraded
    for (const args of [{code: 'DB::update(\'update orders set paid = 1\');'}, {code: '1;', guard: 'rollback'}]) {
      const answer = await server.call('tinkr_run_php', args)

      expect(answer.isError).toBe(false)
      expect(answer.content[0].text).toMatch(/^Guarded run: Live Shop is tagged production/)
      expect(answer.content[0].text).toMatch(/forced to `guard: "sandbox"`/)
      expect(answer.content[0].text).toMatch(/Settings → MCP/)
      expect(answer.structuredContent.production).toEqual({mode: 'guarded', source: 'settings', guard_forced: true})
    }

    expect(guards).toEqual(['sandbox', 'sandbox'])

    // a call that asked for the sandbox itself was not forced
    const asked = await server.call('tinkr_run_php', {code: '1;', guard: 'sandbox'})

    expect(asked.content[0].text).not.toMatch(/Guarded run:/)
    expect(asked.structuredContent.production).toEqual({mode: 'guarded', source: 'settings', guard_forced: false})
  })

  test('refuses code a forced sandbox cannot take back, and says why', async () => {
    dir = makeAppDir({
      config: {mcp_production: 'guarded'},
      connections: {live: connection({id: 'live', name: 'Live Shop', tag: 'production', path: project})},
    })

    const ran = []
    const {server} = opened({
      dataDir: dir,
      connection: 'live',
      run: async (one, code) => {
        ran.push(code)

        return envelope()
      },
    })

    const ddl = await server.call('tinkr_run_php', {code: "Schema::create('orders', fn ($t) => $t->id());"})

    expect(ddl.isError).toBe(true)
    expect(ddl.content[0].text).toMatch(/forced sandbox, which cannot take back/)
    expect(ddl.content[0].text).toMatch(/line 1: Schema::create \(DDL, which MySQL commits on its own\)/)
    expect(ddl.content[0].text).toMatch(/Nothing was run/)

    const transaction = await server.call('tinkr_run_php', {code: '$order->save();\nDB::commit();'})

    expect(transaction.isError).toBe(true)
    expect(transaction.content[0].text).toMatch(/line 2: commit \(a transaction the code closes itself\)/)

    expect(ran).toEqual([])
  })

  test('says a broken forced transaction loudly', async () => {
    dir = makeAppDir({
      config: {mcp_production: 'guarded'},
      connections: {live: connection({id: 'live', name: 'Live Shop', tag: 'production', path: project})},
    })

    const {server} = opened({
      dataDir: dir,
      connection: 'live',
      run: async () => envelope({
        transaction: {mode: 'rollback', armed: true, outcome: 'broken', statements: 1, connection: 'live', error: 'DDL committed'},
      }),
    })

    const answer = await server.call('tinkr_run_php', {code: "DB::update('update orders set paid = 1');"})

    expect(answer.isError).toBe(false)
    expect(answer.content[0].text).toMatch(/^Guarded run BROKEN: the sandbox's transaction was closed/)
    expect(answer.content[0].text).toMatch(/may have been kept on Live Shop/)
    expect(answer.content[0].text).toMatch(/Dry run BROKEN/)
  })

  test('lets a connection override the setting, both ways, as it changes', async () => {
    const live = connection({id: 'live', name: 'Live Shop', tag: 'production', path: project})

    dir = makeAppDir({connections: {live}})

    const ran = []
    const {server} = opened({
      dataDir: dir,
      connection: 'live',
      run: async (one, code, options) => {
        ran.push({code, guard: options.guard})

        return envelope()
      },
    })
    const config = mode => fs.writeFileSync(app.configFile(dir), JSON.stringify({mcp_production: mode}))
    const access = value => fs.writeFileSync(app.connectionsFile(dir), JSON.stringify({
      live: Object.assign({}, live, value === null ? {} : {mcp_access: value}),
    }))

    // the setting refuses, the connection allows: the connection wins
    access('allow')

    const allowed = await server.call('tinkr_run_php', {code: '1;'})

    expect(allowed.isError).toBe(false)
    expect(allowed.structuredContent.production).toEqual({mode: 'allow', source: 'connection', guard_forced: false})

    // the setting allows, the connection refuses: the connection still wins
    config('allow')
    access('refuse')

    const refused = await server.call('tinkr_run_php', {code: '2;'})

    expect(refused.isError).toBe(true)
    expect(refused.content[0].text).toMatch(/its own MCP access/)
    expect(refused.content[0].text).toMatch(/Settings → MCP/)

    // and an override taken away follows the setting again: guarded, so the
    // sandbox is forced on the next run of the same server
    access('')
    config('guarded')

    const guarded = await server.call('tinkr_run_php', {code: '3;'})

    expect(guarded.isError).toBe(false)
    expect(guarded.structuredContent.production).toEqual({mode: 'guarded', source: 'settings', guard_forced: true})
    expect(ran).toEqual([{code: '1;', guard: null}, {code: '3;', guard: 'sandbox'}])
  })

  test('leaves a connection that is not production alone, whatever the mode', async () => {
    dir = makeAppDir({
      config: {mcp_production: 'guarded'},
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
    })

    const guards = []
    const {server} = opened({
      dataDir: dir,
      connection: 'local',
      run: async (one, code, options) => {
        guards.push(options.guard)

        return envelope()
      },
    })

    const answer = await server.call('tinkr_run_php', {code: '1;'})

    expect(answer.isError).toBe(false)
    expect(guards).toEqual([null])
    expect(answer.content[0].text).not.toMatch(/Guarded run/)
    expect(answer.structuredContent.production).toBeUndefined()
  })

  test('records the mode and a forced guard in the journal', async () => {
    dir = makeAppDir({
      config: {mcp_production: 'guarded'},
      connections: {live: connection({id: 'live', name: 'Live Shop', tag: 'production', path: project})},
    })

    const records = []
    const journal = {now: () => 0, begin: () => {}, record: call => records.push(call)}
    const {server} = opened({
      dataDir: dir,
      connection: 'live',
      journal,
      run: async () => envelope(),
    })

    await server.call('tinkr_run_php', {code: '1;'})

    expect(records[0]).toMatchObject({
      tool: 'tinkr_run_php',
      mode: 'guarded',
      modeSource: 'settings',
      guard: 'sandbox',
      guardForced: true,
    })
  })

  test('lists the connections the app lists', async () => {
    dir = makeAppDir({
      connections: {
        local: connection({id: 'local', name: 'The App', path: project}),
        production: connection({
          id: 'production',
          name: 'Production',
          is_over_ssh: true,
          ssh_server: 'example.com',
          ssh_user: 'deploy',
          ssh_port: 2222,
          path: '/srv/app',
        }),
      },
    })

    const {server} = opened({dataDir: dir})
    const answer = await server.call('tinkr_list_connections', {})

    expect(answer.structuredContent.connections).toEqual([
      {
        id: 'local',
        name: 'The App',
        tag: 'local',
        directory: project,
        command: null,
        over_ssh: false,
        ssh: null,
      },
      {
        id: 'production',
        name: 'Production',
        tag: 'local',
        directory: null,
        command: null,
        over_ssh: true,
        ssh: {server: 'example.com', user: 'deploy', port: 2222},
      },
    ])
  })

  // what an MCP client is told about a connection: a pod's namespace, context,
  // kubeconfig and container are how the code reaches it, so they are in the
  // answer rather than left for the client to guess
  test('says which pod, namespace and container a connection reaches', () => {
    const pod = connectionInfo({
      id: 'pod',
      name: 'Production pod',
      container_engine: 'kubectl',
      container_name: 'api-7f9',
      container_path: '/var/www/html',
      container_command: 'php artisan tinker',
      kube_config: '/home/me/.kube/prod.yaml',
      kube_context: 'prod-eu',
      kube_namespace: 'production',
      kube_container: 'php',
    })

    expect(pod.container).toEqual({
      engine: 'kubectl',
      name: 'api-7f9',
      path: '/var/www/html',
      command: 'php artisan tinker',
      kube_config: '/home/me/.kube/prod.yaml',
      kube_context: 'prod-eu',
      kube_namespace: 'production',
      kube_container: 'php',
    })

    // a field the connection does not name is a flag the command does not carry,
    // and is not in the answer either
    const podOnly = connectionInfo({id: 'pod', container_engine: 'kubectl', container_name: 'api-7f9'})

    expect(Object.keys(podOnly.container)).toEqual(['engine', 'name', 'path', 'command'])

    // and a connection that is not in a container has no container to describe
    expect(connectionInfo({id: 'local', path: project}).container).toBe(undefined)
  })

  test('reads and keeps the snippets of a connection the app knows', async () => {
    dir = makeAppDir({
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
      snippets: {
        local: {abc: {id: 'abc', code: '$n = 1;', name: 'One', position: {lineNumber: 1, column: 1}}},
      },
    })

    const {server} = opened({dataDir: dir, at: project})

    const listed = await server.call('tinkr_list_snippets', {})

    expect(listed.structuredContent.snippets).toEqual([{id: 'abc', name: 'One', code: '$n = 1;'}])

    const saved = await server.call('tinkr_save_snippet', {code: 'User::count();', name: 'Count users'})

    expect(saved.isError).toBe(false)
    expect(app.snippets(dir, 'local').map(one => one.name).sort()).toEqual(['Count users', 'One'])
  })

  test('deletes a snippet, and says what it deleted', async () => {
    dir = makeAppDir({
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
      snippets: {local: {abc: {id: 'abc', code: '$n = 1;', name: 'One'}}},
    })

    const {server} = opened({dataDir: dir, at: project})
    const answer = await server.call('tinkr_delete_snippet', {id: 'abc'})

    expect(answer.isError).toBe(false)
    expect(answer.structuredContent.deleted).toBe(true)
    expect(answer.structuredContent.name).toBe('One')
    expect(app.snippets(dir, 'local')).toEqual([])

    // a second delete is not an error: it says the snippet was already gone
    const again = await server.call('tinkr_delete_snippet', {id: 'abc'})

    expect(again.isError).toBe(false)
    expect(again.structuredContent.deleted).toBe(false)
    expect(again.content[0].text).toMatch(/nothing was deleted/)
  })

  test('refuses to keep a snippet for a directory that is not a connection', async () => {
    dir = makeAppDir()

    const {server} = opened({at: '/tmp/elsewhere', dataDir: dir})

    const answer = await server.call('tinkr_save_snippet', {code: '1;', name: 'One'})

    expect(answer.isError).toBe(true)
    expect(answer.content[0].text).toMatch(/no connection for/)
  })

  test('lists the runs the app kept, newest first, as many as it is asked for', async () => {
    dir = makeAppDir({
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
      history: {
        local: {
          entries: [
            {id: 'second', code: 'User::count();', at: 1760000100000, outcome: 'returned', value: 3},
            {id: 'first', code: 'echo "hi";', at: 1760000000000, outcome: 'printed', output: 'hi'},
          ],
        },
      },
    })

    const {server} = opened({dataDir: dir, at: project})
    const listed = await server.call('tinkr_list_history', {})

    expect(listed.structuredContent.runs).toEqual([
      {
        id: 'second',
        at: new Date(1760000100000).toISOString(),
        outcome: 'returned',
        code: 'User::count();',
      },
      {
        id: 'first',
        at: new Date(1760000000000).toISOString(),
        outcome: 'printed',
        code: 'echo "hi";',
      },
    ])
    expect(listed.content[0].text).toContain('returned')
    expect(listed.content[0].text).toContain('User::count();')

    const one = await server.call('tinkr_list_history', {limit: 1})

    expect(one.structuredContent.runs.map(run => run.id)).toEqual(['second'])
  })

  test('a connection that has run nothing says so', async () => {
    dir = makeAppDir({
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
    })

    const {server} = opened({dataDir: dir, at: project})
    const listed = await server.call('tinkr_list_history', {})

    expect(listed.content[0].text).toBe('This connection has run nothing yet.')
    expect(listed.structuredContent.runs).toEqual([])
  })

  test('reads one run, with what came back and what was too big to keep', async () => {
    dir = makeAppDir({
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
      history: {
        local: {
          entries: [{
            id: 'a1',
            code: 'throw new RuntimeException("boom");',
            at: 1760000000000,
            outcome: 'threw',
            error: {class: 'RuntimeException', message: 'boom'},
            output: 'before it threw',
            cut: ['output'],
          }],
        },
      },
    })

    const {server} = opened({dataDir: dir, at: project})
    const run = await server.call('tinkr_read_run', {id: 'a1'})

    expect(run.isError).toBe(false)
    expect(run.content[0].text).toContain('threw RuntimeException: boom')
    expect(run.content[0].text).toContain('printed:')
    expect(run.content[0].text).toContain('before it threw')
    expect(run.content[0].text).toContain('not kept whole: output')
    expect(run.structuredContent).toMatchObject({
      id: 'a1',
      outcome: 'threw',
      at: new Date(1760000000000).toISOString(),
      cut: ['output'],
    })
  })

  test('a run the app does not keep is not there to read', async () => {
    dir = makeAppDir({
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
      history: {local: {entries: [{id: 'a1', code: '1;', at: 1760000000000, outcome: 'returned', value: 1}]}},
    })

    const {server} = opened({dataDir: dir, at: project})
    const missing = await server.call('tinkr_read_run', {id: 'nope'})

    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toMatch(/No run with the id nope/)
  })

  test('the history belongs to a connection the app knows, like the snippets do', async () => {
    dir = makeAppDir()

    const {server} = opened({at: '/tmp/elsewhere', dataDir: dir})
    const listed = await server.call('tinkr_list_history', {})

    expect(listed.isError).toBe(true)
    expect(listed.content[0].text).toMatch(/no connection for/)
  })

  test('asks for the code it is going to run', async () => {
    const {server} = opened({at: project, run: async () => envelope()})

    // a call that leaves out what the tool declares is answered as a protocol
    // error, before the tool runs: there is no code to run and no answer of a
    // run to give
    await expect(server.call('tinkr_run_php', {}))
      .rejects.toMatchObject({code: -32602, message: expect.stringMatching(/`code` is required/)})
  })
})

describe('the log tools', () => {
  let dir = null
  let logs = null

  const line = (at, level, message) => `[${at}] production.${level}: ${message}`

  // a project with the logs a connection has, and a connection of the app that
  // runs in it: the newest file is the one a call reads when it names none
  const openedOn = (files, options = {}) => {
    logs = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-logs-'))

    fs.mkdirSync(path.join(logs, 'storage', 'logs'), {recursive: true})

    for (const [name, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(logs, 'storage', 'logs', name), text)
    }

    dir = makeAppDir(Object.assign(
      {connections: {one: connection({id: 'one', name: 'One', path: logs})}},
      options,
    ))

    return opened({at: logs, dataDir: dir}).server
  }

  const newest = (files, name) => {
    const at = new Date()
    const older = new Date(at.getTime() - 60000)

    fs.utimesSync(path.join(logs, 'storage', 'logs', name), at, at)

    for (const other of Object.keys(files)) {
      if (other !== name) {
        fs.utimesSync(path.join(logs, 'storage', 'logs', other), older, older)
      }
    }
  }

  afterEach(() => {
    if (dir) {
      removeAppDir(dir)
      dir = null
    }

    if (logs) {
      fs.rmSync(logs, {recursive: true, force: true})
      logs = null
    }
  })

  test('lists the log files of the connection, newest first', async () => {
    const files = {
      'laravel.log': `${line('2026-08-27 12:00:00', 'ERROR', 'the newest')}\n`,
      'evo-2026-08-26.log': `${line('2026-08-26 12:00:00', 'INFO', 'the older')}\n`,
    }

    const server = openedOn(files)

    newest(files, 'laravel.log')

    const answer = await server.call('tinkr_list_logs', {})

    expect(answer.isError).toBe(false)
    expect(answer.structuredContent.dir).toBe(path.join(logs, 'storage', 'logs'))
    expect(answer.structuredContent.files.map(one => one.name)).toEqual(['laravel.log', 'evo-2026-08-26.log'])
    expect(answer.structuredContent.files[0].size).toBe(Buffer.byteLength(files['laravel.log']))
    expect(answer.structuredContent.files[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(answer.content[0].text).toContain('2 log files in')
    expect(answer.content[0].text).toContain('laravel.log')
  })

  test('reads the end of the newest file when it names none', async () => {
    const files = {
      'laravel.log': [
        line('2026-08-27 11:00:00', 'INFO', 'the job ran'),
        line('2026-08-27 12:00:00', 'ERROR', 'No certificate found'),
      ].join('\n') + '\n',
      'evo-2026-08-26.log': `${line('2026-08-26 12:00:00', 'INFO', 'the older file')}\n`,
    }

    const server = openedOn(files)

    newest(files, 'laravel.log')

    const answer = await server.call('tinkr_tail_logs', {})

    expect(answer.isError).toBe(false)
    expect(answer.structuredContent.file).toBe('laravel.log')
    expect(answer.structuredContent.filtered).toBe(false)
    expect(answer.structuredContent.entries.map(one => one.message)).toEqual(['the job ran', 'No certificate found'])
    expect(answer.content[0].text).toContain('[2026-08-27 12:00:00] production.ERROR: No certificate found')
  })

  test('scans the whole file for a level, and says what it left behind', async () => {
    const server = openedOn({
      'laravel.log': [
        line('2026-08-27 10:00:00', 'ERROR', 'first'),
        '[stacktrace]',
        '#0 /app/a.php(1): go()',
        line('2026-08-27 11:00:00', 'INFO', 'the job ran'),
        line('2026-08-27 12:00:00', 'ERROR', 'second'),
      ].join('\n') + '\n',
    })

    const answer = await server.call('tinkr_tail_logs', {level: 'error', limit: 1})

    expect(answer.isError).toBe(false)
    expect(answer.structuredContent.filtered).toBe(true)
    expect(answer.structuredContent.entries.map(one => one.message)).toEqual(['second'])
    expect(answer.structuredContent.older).toBe(1)
    expect(answer.content[0].text).toContain('1 older matching entry was not included')
  })

  test('answers with the entries of a range, and with none when nothing matches', async () => {
    const server = openedOn({
      'laravel.log': [
        line('2026-08-27 10:00:00', 'ERROR', 'before the range'),
        line('2026-08-27 12:00:00', 'ERROR', 'inside the range'),
      ].join('\n') + '\n',
    })

    const inside = await server.call('tinkr_tail_logs', {
      level: 'error',
      since: '2026-08-27 11:00:00',
      until: '2026-08-27 13:00:00',
    })

    expect(inside.structuredContent.entries.map(one => one.message)).toEqual(['inside the range'])

    const none = await server.call('tinkr_tail_logs', {level: 'warning'})

    expect(none.isError).toBe(false)
    expect(none.structuredContent.entries).toEqual([])
    expect(none.content[0].text).toContain('No entry in that range matches.')
  })

  test('reads a page before a window, and says there is more before it', async () => {
    const many = Array.from({length: 200}, (unused, at) => line('2026-08-27 10:00:00', 'INFO', `entry ${at} `.padEnd(60, '.')))

    const server = openedOn({'laravel.log': many.join('\n') + '\n'})

    const end = await server.call('tinkr_tail_logs', {bytes: 2048})
    const before = await server.call('tinkr_tail_logs', {bytes: 2048, before: end.structuredContent.from})

    expect(before.isError).toBe(false)
    expect(before.structuredContent.to).toBe(end.structuredContent.from)
    expect(before.content[0].text).toContain(`before: ${before.structuredContent.from}`)
  })

  test('reads a project that keeps its logs somewhere else', async () => {
    logs = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-custom-'))

    fs.mkdirSync(path.join(logs, 'var', 'logs'), {recursive: true})
    fs.writeFileSync(path.join(logs, 'var', 'logs', 'app.log'), `${line('2026-08-27 12:00:00', 'INFO', 'elsewhere')}\n`)

    dir = makeAppDir({
      connections: {one: connection({id: 'one', name: 'One', path: logs})},
      logDir: 'var/logs',
    })

    const server = opened({at: logs, dataDir: dir}).server
    const answer = await server.call('tinkr_list_logs', {})

    expect(answer.structuredContent.dir).toBe(path.join(logs, 'var', 'logs'))
    expect(answer.structuredContent.files.map(one => one.name)).toEqual(['app.log'])
  })

  test('says the connection has no logs rather than failing', async () => {
    const server = openedOn({})

    const listed = await server.call('tinkr_list_logs', {})

    expect(listed.isError).toBe(false)
    expect(listed.structuredContent.files).toEqual([])
    expect(listed.content[0].text).toContain('No log files are in')

    const read = await server.call('tinkr_tail_logs', {})

    expect(read.isError).toBe(false)
    expect(read.content[0].text).toContain('there is nothing to read')
  })

  test('asks for a moment in the shape a log writes one', async () => {
    const server = openedOn({'laravel.log': `${line('2026-08-27 12:00:00', 'INFO', 'one')}\n`})

    const since = await server.call('tinkr_tail_logs', {since: 'yesterday'})

    expect(since.isError).toBe(true)
    expect(since.content[0].text).toMatch(/`since` has to be a moment written as "2026-08-27 11:10:52"/)

    const level = await server.call('tinkr_tail_logs', {level: 'eror'})

    expect(level.isError).toBe(true)
    expect(level.content[0].text).toMatch(/is not a level a log holds/)
  })

  test('treats an empty term as no filter at all', async () => {
    const server = openedOn({
      'laravel.log': [
        line('2026-08-27 11:00:00', 'INFO', 'the job ran'),
        line('2026-08-27 12:00:00', 'ERROR', 'No certificate found'),
      ].join('\n') + '\n',
    })

    const answer = await server.call('tinkr_tail_logs', {term: '   '})

    expect(answer.isError).toBe(false)
    expect(answer.structuredContent.filtered).toBe(false)
    expect(answer.structuredContent.entries).toHaveLength(2)
  })

  test('keeps the levels of a list', async () => {
    const server = openedOn({
      'laravel.log': [
        line('2026-08-27 11:00:00', 'INFO', 'the job ran'),
        line('2026-08-27 11:30:00', 'WARNING', 'slow query'),
        line('2026-08-27 12:00:00', 'ERROR', 'No certificate found'),
      ].join('\n') + '\n',
    })

    const answer = await server.call('tinkr_tail_logs', {level: ['error', 'warning']})

    expect(answer.structuredContent.entries.map(one => one.level)).toEqual(['warning', 'error'])
  })

  test('reads nothing whose name is not a log of the connection', async () => {
    const server = openedOn({'laravel.log': `${line('2026-08-27 12:00:00', 'INFO', 'one')}\n`})

    const answer = await server.call('tinkr_tail_logs', {file: '../.env'})

    expect(answer.isError).toBe(true)
    expect(answer.content[0].text).toMatch(/is not a log file/)
  })
})

describe('what an answer hides', () => {
  let dir

  afterEach(() => {
    if (dir) {
      removeAppDir(dir)
      dir = null
    }
  })

  const secret = () => ({
    value: {id: 1, name: 'Ada', password: 'hunter2', remember_token: 'Zx9'},
    blocks: [{line: 1, value: {id: 1, name: 'Ada', password: 'hunter2'}, error: null}],
    error: null,
    output: 'a note, printed',
    queries: [{line: 1, sql: 'update users set password = ?, name = ? where id = ?', bindings: ['hunter2', 'Ada', 1], time: 1, connection: 'fixture'}],
    transaction: {
      armed: true,
      outcome: 'rolledBack',
      statements: 1,
      changes: [{table: 'users', key: {id: 1}, before: {id: 1, password: 'old'}, after: {id: 1, password: 'new'}}],
    },
  })

  const appDir = () => {
    dir = makeAppDir({
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
    })

    return dir
  }

  test('the run tool hides a field in its structured answer and in its text', async () => {
    const {server} = opened({dataDir: appDir(), at: project, run: async () => secret()})
    const answer = await server.call('tinkr_run_php', {code: 'User::first();'})

    expect(answer.isError).toBe(false)
    expect(answer.structuredContent.value).toEqual({id: 1, name: 'Ada', password: '[hidden]', remember_token: '[hidden]'})
    expect(answer.structuredContent.blocks[0].value.password).toBe('[hidden]')
    expect(answer.structuredContent.queries[0].bindings).toEqual(['[hidden]', 'Ada', 1])
    expect(answer.structuredContent.transaction.changes[0].before.password).toBe('[hidden]')
    expect(answer.structuredContent.transaction.changes[0].after.password).toBe('[hidden]')

    expect(answer.content[0].text).not.toContain('hunter2')
    expect(answer.content[0].text).toContain('"password": "[hidden]"')
    // what the run printed is text, and it is kept
    expect(answer.content[0].text).toContain('a note, printed')
  })

  test('the list the app writes is what hides a field, on every call', async () => {
    const dataDir = appDir()

    dir = dataDir

    fs.writeFileSync(app.configFile(dataDir), JSON.stringify({redact_fields: ['nickname']}))

    const {server} = opened({
      dataDir,
      at: project,
      run: async () => envelope({value: {nickname: 'Ada', password: 'hunter2'}, blocks: []}),
    })

    const named = await server.call('tinkr_run_php', {code: '1;'})

    expect(named.structuredContent.value).toEqual({nickname: '[hidden]', password: 'hunter2'})

    // the same server, still running: the next answer follows the file
    fs.writeFileSync(app.configFile(dataDir), JSON.stringify({redact_fields: []}))

    const kept = await server.call('tinkr_run_php', {code: '2;'})

    expect(kept.structuredContent.value).toEqual({nickname: 'Ada', password: 'hunter2'})
  })

  test('a configuration with no list is the default list', async () => {
    const {server} = opened({
      dataDir: appDir(),
      at: project,
      run: async () => envelope({value: {id: 1, password: 'hunter2'}, blocks: []}),
    })

    const answer = await server.call('tinkr_run_php', {code: '1;'})

    expect(answer.structuredContent.value).toEqual({id: 1, password: '[hidden]'})
  })

  test('reading a run hides a value the file kept, in both answers', async () => {
    dir = makeAppDir({
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
      history: {
        local: {
          entries: [{
            id: 'a1',
            code: 'User::first();',
            at: 1760000000000,
            outcome: 'returned',
            value: {id: 1, password: 'hunter2', remember_token: 'Zx9'},
            output: '',
          }],
        },
      },
    })

    const {server} = opened({dataDir: dir, at: project})
    const run = await server.call('tinkr_read_run', {id: 'a1'})

    expect(run.structuredContent.value).toEqual({id: 1, password: '[hidden]', remember_token: '[hidden]'})
    expect(run.content[0].text).not.toContain('hunter2')
    expect(run.content[0].text).toContain('"password": "[hidden]"')
  })

  test('listing the history answers with no value at all', async () => {
    dir = makeAppDir({
      connections: {local: connection({id: 'local', name: 'The App', path: project})},
      history: {
        local: {
          entries: [{
            id: 'a1',
            code: 'User::first();',
            at: 1760000000000,
            outcome: 'returned',
            value: {id: 1, password: 'hunter2'},
          }],
        },
      },
    })

    const {server} = opened({dataDir: dir, at: project})
    const listed = await server.call('tinkr_list_history', {})

    expect(JSON.stringify(listed)).not.toContain('hunter2')
    expect(listed.structuredContent.runs[0].code).toBe('User::first();')
  })

  test('the ssh run tool hides the same fields', async () => {
    dir = makeAppDir({
      connections: {
        server: connection({id: 'server', name: 'Server', is_over_ssh: true, ssh_server: 'example.com', ssh_user: 'deploy'}),
      },
    })

    const {server} = opened({
      dataDir: dir,
      connection: 'server',
      run: async () => envelope({
        value: {id: 1, token: 'Zx9'},
        blocks: [{line: 1, value: {id: 1, token: 'Zx9'}, error: null}],
      }),
    })
    const answer = await server.call('tinkr_run_php_over_ssh', {code: '1;'})

    expect(answer.isError).toBe(false)
    expect(answer.structuredContent.value).toEqual({id: 1, token: '[hidden]'})
    expect(answer.content[0].text).toContain('"token": "[hidden]"')
  })
})

describe('the arguments of a call', () => {
  test('refuses an argument the tool does not take, before anything runs', async () => {
    const calls = []
    const {server} = opened({
      at: project,
      dataDir: '/nowhere',
      run: async (connection, code) => {
        calls.push(code)

        return envelope()
      },
    })

    // a dry run the tool has no argument for: an ignored key here is the run
    // the caller was trying not to make
    await expect(server.call('tinkr_run_php', {code: 'DB::table("users")->delete();', dry_run: true}))
      .rejects.toMatchObject({
        code: -32602,
        message: expect.stringMatching(
          /`dry_run` is not an argument tinkr_run_php takes\. It takes: code, path, connection, guard, timeout_ms\./,
        ),
      })

    expect(calls).toEqual([])
  })

  test('refuses an argument of the wrong type, and names it', async () => {
    const {server} = opened({at: project, dataDir: '/nowhere'})

    await expect(server.call('tinkr_run_php', {code: '1;', timeout_ms: '5000'}))
      .rejects.toMatchObject({
        code: -32602,
        message: expect.stringMatching(/`timeout_ms` has to be a number, not a string\./),
      })
  })

  test('refuses a value the schema does not allow, and one outside its range', async () => {
    const {server} = opened({at: project, dataDir: '/nowhere'})

    await expect(server.call('tinkr_run_php', {code: '1;', guard: 'pretend'}))
      .rejects.toMatchObject({
        code: -32602,
        message: expect.stringMatching(/`guard` has to be one of "rollback", "sandbox", not "pretend"\./),
      })

    await expect(server.call('tinkr_list_history', {limit: 500}))
      .rejects.toMatchObject({
        code: -32602,
        message: expect.stringMatching(/`limit` has to be at most 50: it was 500\./),
      })
  })

  test('does not change a call that fits its schema', async () => {
    const {server} = opened({at: project, dataDir: '/nowhere'})

    const answer = await server.call('tinkr_run_php', {code: '1;', timeout_ms: 5000})

    expect(answer.isError).toBe(false)
    expect(answer.structuredContent.value).toBe(3)
  })

  test('answers from the data directory it was given, never from the default one', async () => {
    const elsewhere = makeAppDir({
      connections: {zeta: connection({id: 'zeta', name: 'Zeta', path: project})},
      snippets: {zeta: {abc: {id: 'abc', code: '$n = 1;', name: 'One'}}},
    })
    // the machine's own app data is there, with a connection in it; the
    // directory this server was pointed at holds no connections file at all
    const find = jest.spyOn(app, 'find').mockImplementation(found => (found ? null : elsewhere))

    try {
      const {server} = opened({at: project, dataDir: '/nowhere'})

      // a call that names a connection reads the profile the server was given,
      // and there is no such connection in it: reading the default one would
      // answer with another profile's snippets, mode and saved password
      const answer = await server.call('tinkr_list_snippets', {connection: 'Zeta'})

      expect(answer.isError).toBe(true)
      expect(answer.content[0].text).toMatch(/no connection "Zeta"/)

      const listed = await server.call('tinkr_list_connections', {})

      expect(listed.structuredContent.connections).toEqual([])
    } finally {
      find.mockRestore()
      removeAppDir(elsewhere)
    }
  })

  test('says the run tool can reach the world, because the code it runs can', () => {
    const {server} = opened({at: project, dataDir: '/nowhere'})

    // a run makes HTTP calls, or reaches Laravel Cloud and Laravel Vapor, as
    // easily as it touches a row: a client that auto-approves on the hint has
    // to read it as open
    for (const name of ['tinkr_run_php', 'tinkr_run_php_over_ssh']) {
      expect(server.tools.find(one => one.name === name).annotations.openWorldHint).toBe(true)
    }
  })
})
