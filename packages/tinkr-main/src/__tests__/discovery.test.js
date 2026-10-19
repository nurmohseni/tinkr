jest.mock('../remote', () => ({exec: jest.fn()}))

const {exec} = require('../remote')

const {containers, projectDirs} = require('../services/discovery')

const answered = (stdout, code = 0) => exec.mockResolvedValue({stdout, stderr: '', code})

beforeEach(() => {
  exec.mockReset()
})

describe('what a container connection can offer', () => {
  // the name is not something to type: a compose file and a PaaS name one per
  // deploy, so the form offers what is running now
  test('lists the containers an engine reports, with what they run', async () => {
    answered('app-abc123\tmy/app:latest\ndb-1\tpostgres:16\n')

    const found = await containers({container_engine: 'docker'})

    expect(found).toEqual([
      {name: 'app-abc123', image: 'my/app:latest'},
      {name: 'db-1', image: 'postgres:16'},
    ])

    // the question is the engine's, asked on the machine the connection reaches
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({container_engine: 'docker'}),
      expect.stringContaining('docker ps'),
      expect.anything(),
    )
  })

  // a machine that cannot answer is a form with nothing to offer, not a failure:
  // a typed name is still what a connection the app cannot list uses
  test('answers nothing rather than failing when the machine cannot', async () => {
    answered('', 1)
    expect(await containers({container_engine: 'docker'})).toEqual([])

    exec.mockRejectedValue(new Error('ssh: connect to host: Connection refused'))
    expect(await containers({container_engine: 'docker'})).toEqual([])
  })

  test('asks nothing of a connection that names no engine', async () => {
    expect(await containers({})).toEqual([])
    expect(await containers({container_engine: 'nonsense'})).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })

  // a deployed project is wherever its image put it, so the path is found
  test('offers the directories inside a container that look like a project', async () => {
    answered('/var/www/html\n/srv/app\n')

    const found = await projectDirs({
      container_engine: 'docker',
      container_name: 'app-abc123',
      container_path: '/var/www/html',
    })

    expect(found).toEqual(['/srv/app', '/var/www/html'])

    // asked inside the container, from its own idea of the project's directory
    const question = exec.mock.calls[0][1]

    expect(question).toContain('docker exec -i')
    expect(question).toContain('cd /var/www/html')
    expect(question).toContain('composer.json')
  })

  test('answers nothing for a container that is not there', async () => {
    answered('', 1)

    expect(await projectDirs({container_engine: 'docker', container_name: 'gone'})).toEqual([])
  })
})
