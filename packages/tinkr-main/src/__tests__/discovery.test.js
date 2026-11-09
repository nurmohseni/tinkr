jest.mock('../remote', () => ({exec: jest.fn()}))

const {exec} = require('../remote')

const {containers, projectDirs, contexts, namespaces} = require('../services/discovery')

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

  // a pod in another namespace, or in another cluster, is not in the list of the
  // one the current context reaches
  test('lists the pods of the namespace and the cluster a connection names', async () => {
    answered('NAME   IMAGE\napi-7f9  my/app:latest\n')

    const found = await containers({
      container_engine: 'kubectl',
      kube_config: '/home/me/.kube/prod.yaml',
      kube_context: 'prod-eu',
      kube_namespace: 'production',
    })

    expect(found).toEqual([{name: 'api-7f9', image: 'my/app:latest'}])

    const question = exec.mock.calls[0][1]

    expect(question).toContain('--kubeconfig /home/me/.kube/prod.yaml')
    expect(question).toContain('--context prod-eu')
    expect(question).toContain('get pods -n production')
  })

  // a context and a namespace are names nobody should have to recall, and a
  // machine that cannot list them offers nothing rather than failing
  test('offers the contexts of a kubeconfig and the namespaces of a cluster', async () => {
    answered('prod-eu\nstaging\n')

    expect(await contexts({kube_config: '/home/me/.kube/prod.yaml'})).toEqual(['prod-eu', 'staging'])
    expect(exec.mock.calls[0][1]).toBe('kubectl --kubeconfig /home/me/.kube/prod.yaml config get-contexts -o name')

    // `-o name` prints a namespace as `namespace/<name>`, and the name is what
    // the field and the flag take
    answered('namespace/production\nnamespace/staging\n')

    expect(await namespaces({kube_context: 'prod-eu'})).toEqual(['production', 'staging'])
    expect(exec.mock.calls[1][1]).toBe('kubectl --context prod-eu get namespaces -o name')

    answered('', 1)

    expect(await contexts({})).toEqual([])
    expect(await namespaces({})).toEqual([])
  })
})
