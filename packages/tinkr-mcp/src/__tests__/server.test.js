const path = require('path')

const {makeAppDir, removeAppDir, connection} = require('../__fixtures__/app')
const app = require('../app')
const target = require('../target')
const {createServer, render} = require('../server')

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
      at: '/tmp/project',
      run: async (connection, code, options) => {
        seen.push({connection, code, options})

        return envelope()
      },
    })

    const answer = await server.call('tinkr_run_php', {code: '$orders = 3;'})

    expect(seen[0].connection.path).toBe(path.resolve('/tmp/project'))
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
      at: '/tmp/project',
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
      at: '/tmp/project',
      run: async () => {
        throw new Error('the session did not answer within 60000ms')
      },
    })

    const answer = await server.call('tinkr_run_php', {code: 'sleep(60);'})

    expect(answer.isError).toBe(true)
    expect(answer.content[0].text).toBe('the session did not answer within 60000ms')
  })

  test('waits as long as the caller asks, within reason', async () => {
    const seen = []
    const {server} = opened({
      at: '/tmp/project',
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
        local: connection({id: 'local', name: 'Local', path: '/tmp/project'}),
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
        local: connection({id: 'local', name: 'The App', path: '/tmp/project'}),
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
        directory: '/tmp/project',
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
      connections: {local: connection({id: 'local', name: 'The App', path: '/tmp/project'})},
      snippets: {
        local: {abc: {id: 'abc', code: '$n = 1;', name: 'One', position: {lineNumber: 1, column: 1}}},
      },
    })

    const {server} = opened({dataDir: dir, at: '/tmp/project'})

    const listed = await server.call('tinkr_list_snippets', {})

    expect(listed.structuredContent.snippets).toEqual([{id: 'abc', name: 'One', code: '$n = 1;'}])

    const saved = await server.call('tinkr_save_snippet', {code: 'User::count();', name: 'Count users'})

    expect(saved.isError).toBe(false)
    expect(app.snippets(dir, 'local').map(one => one.name).sort()).toEqual(['Count users', 'One'])
  })

  test('refuses to keep a snippet for a directory that is not a connection', async () => {
    dir = makeAppDir()

    const {server} = opened({at: '/tmp/elsewhere', dataDir: dir})

    const answer = await server.call('tinkr_save_snippet', {code: '1;', name: 'One'})

    expect(answer.isError).toBe(true)
    expect(answer.content[0].text).toMatch(/no connection for/)
  })

  test('asks for the code it is going to run', async () => {
    const {server} = opened({at: '/tmp/project', run: async () => envelope()})

    const answer = await server.call('tinkr_run_php', {})

    expect(answer.isError).toBe(true)
    expect(answer.content[0].text).toMatch(/`code` is required/)
  })
})
