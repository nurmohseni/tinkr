const fs = require('fs')
const os = require('os')
const path = require('path')

const {makeAppDir, removeAppDir, connection} = require('../__fixtures__/app')
const app = require('../app')
const target = require('../target')
const {createServer, render} = require('../server')

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

const opened = ({run = async () => envelope(), at, connection: named, command, dataDir, timeout} = {}) => {
  const resolved = target.resolve({connection: named, at, command, dataDir})

  return {resolved, server: createServer({target: resolved, version: '0.1.0', timeout, run})}
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

    const answer = await server.call('tinkr_run_php', {})

    expect(answer.isError).toBe(true)
    expect(answer.content[0].text).toMatch(/`code` is required/)
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
