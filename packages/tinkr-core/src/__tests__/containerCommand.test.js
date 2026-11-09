const {
  containerCommand, sessionCommand, containerRead, containerPath, containerDir, inContainer, connectionKind, engineNames,
  containerList, containersIn, projectDirsCommand, projectDirsIn,
  kubeContextsCommand, kubeNamespacesCommand, kubeNamesIn,
} = require('../containerCommand')
const {parseSSHCommand} = require('../parseSSHCommand')
const {controlOptions} = require('../sshControl')

// the multiplexing options a session's line carries in front of everything else
// (see sshControl), as words of the shell line it is typed into
const multiplexed = connection => controlOptions(connection).map(option => `'${option}'`)

describe('a container connection', () => {
  test('builds the command of the engine it names', () => {
    expect(containerCommand({container_engine: 'docker', container_name: 'app'}))
      .toBe('docker exec -it app php artisan tinker')
    expect(containerCommand({container_engine: 'podman', container_name: 'laravel.test', container_command: 'php artisan tinker'}))
      .toBe('podman exec -it laravel.test php artisan tinker')
    // sail is laravel's wrapper around docker compose: the container is a service
    expect(containerCommand({container_engine: 'sail', container_name: 'laravel.test'}))
      .toBe('./vendor/bin/sail laravel.test php artisan tinker')
    // a pod with several containers is named the way kubectl names it
    expect(containerCommand({container_engine: 'kubectl', container_name: 'pod/app'}))
      .toBe('kubectl exec -it pod/app -- php artisan tinker')
  })

  test('quotes a container name that is not one word to the shell', () => {
    expect(containerCommand({container_engine: 'docker', container_name: 'my app'}))
      .toBe("docker exec -it 'my app' php artisan tinker")
  })

  test('is nothing when it names no container, rather than a broken command', () => {
    // `docker exec -it  php artisan tinker` is a command that runs the shell's
    // own `php`, which is not what anyone asked for
    expect(containerCommand({container_engine: 'docker', container_name: ''})).toBe('')
    expect(containerCommand({container_engine: 'docker'})).toBe('')
    expect(containerCommand({container_engine: 'nonsense', container_name: 'app'})).toBe('')
    expect(containerCommand({})).toBe('')
  })

  test('is a local connection that runs elsewhere, not an ssh one', () => {
    // the files are on this machine, which is what the index and the logs read
    expect(connectionKind({container_engine: 'docker', container_name: 'app'})).toBe('container')
    expect(connectionKind({is_over_ssh: true, container_engine: 'docker'})).toBe('ssh-container')
    expect(connectionKind({is_over_ssh: true})).toBe('ssh')
    expect(connectionKind({})).toBe('local')
    // a cloud connection runs in an environment Laravel Cloud owns, whatever
    // else the connection was saved with: its own kind is what says so
    expect(connectionKind({is_cloud: true})).toBe('cloud')
    expect(connectionKind({is_cloud: true, is_over_ssh: true, container_engine: 'docker'})).toBe('cloud')
    expect(connectionKind({is_cloud: false, is_over_ssh: true})).toBe('ssh')
    // and a Vapor connection runs in an environment that API owns, so it is its
    // own kind too
    expect(connectionKind({is_vapor: true})).toBe('vapor')
    expect(connectionKind({is_vapor: true, is_over_ssh: true, container_engine: 'docker'})).toBe('vapor')
  })

  // the engine on a server is the server's: the command is the same words, and
  // the ssh line is what puts them on the far side and in the project's directory
  test('reaches a container on a server with the same command, over ssh', () => {
    const connection = {
      is_over_ssh: true,
      container_engine: 'docker',
      container_name: 'app-abc123',
      path: '/srv/app',
      ssh_user: 'deploy',
      ssh_server: 'srv',
    }

    // what the session runs is the container's command, not `php artisan tinker`
    expect(sessionCommand(connection)).toBe('docker exec -it -w /srv/app app-abc123 php artisan tinker')

    // and the ssh line carries it to the far side unchanged: a containerized
    // deploy need not hold the project on the machine, so there is no `cd` out
    // here — the engine's `-w` is the directory, inside the container
    expect(parseSSHCommand(connection, sessionCommand(connection)))
      .toBe(['ssh', '-t', ...multiplexed(connection), String.raw`'--' 'deploy@srv' 'docker exec -it -w /srv/app app-abc123 php artisan tinker'`].join(' '))

    // when the container sees the project somewhere else, that is the directory
    expect(sessionCommand(Object.assign({}, connection, {container_path: '/var/www/html'})))
      .toBe('docker exec -it -w /var/www/html app-abc123 php artisan tinker')
  })

  test('is a session command that is the connection\'s own when nothing is in a container', () => {
    expect(sessionCommand({is_over_ssh: true, command: 'php artisan tinker'})).toBe('php artisan tinker')
    expect(sessionCommand({command: 'php artisan tinker'})).toBe('php artisan tinker')
    // a container with no name has no command, and one is not guessed for it
    expect(sessionCommand({container_engine: 'docker', container_name: ''})).toBe('')
    expect(sessionCommand(null)).toBe('')
  })

  // the bug this waits against: a container session cd'd into the machine's
  // path, which a containerized deploy need not have at all — the files can be
  // in a volume or only in the image — and the session failed before the
  // container was ever reached
  test('carries the container\'s own directory, not the machine\'s', () => {
    const connection = {
      is_over_ssh: true,
      ssh_user: 'deploy',
      ssh_server: 'srv',
      container_engine: 'docker',
      container_name: 'app',
      path: '/srv/app',
      container_path: '/var/www/html',
    }

    // the engine's `-w` is the directory, inside the container
    expect(sessionCommand(connection)).toBe('docker exec -it -w /var/www/html app php artisan tinker')
    expect(parseSSHCommand(connection, sessionCommand(connection)))
      .toBe(['ssh', '-t', ...multiplexed(connection), String.raw`'--' 'deploy@srv' 'docker exec -it -w /var/www/html app php artisan tinker'`].join(' '))
  })

  test('asks the container, not the machine, for a read of the project', () => {
    const connection = {
      is_over_ssh: true,
      container_engine: 'docker',
      container_name: 'app',
      path: '/srv/app',
      container_path: '/var/www/html',
    }

    // without a container the read is the machine's own php
    expect(containerRead({is_over_ssh: true}, 'php -r 1')).toBe('')
    expect(containerRead({}, 'php -r 1')).toBe('')

    // with one, it runs in the container's directory, as one word to its shell
    expect(containerRead(connection, 'php -r 1'))
      .toBe("docker exec -i app sh -c 'cd /var/www/html && php -r 1'")

    // and the working directory is the container's when it names one
    expect(containerPath(connection)).toBe('/var/www/html')
    expect(containerPath({path: '/srv/app'})).toBe('/srv/app')
  })

  // the bug this waits against: a container created by a compose file or a PaaS
  // is named per deploy, so a name saved in a connection is stale after the next
  // one — what a form offers is what is running now
  test('lists what an engine is running, and reads what it answered', () => {
    expect(containerList('docker')).toContain('docker ps')
    expect(containerList('podman')).toContain('podman ps')
    expect(containerList('kubectl')).toContain('kubectl get pods')

    // a name and an image per line, which is what tells one container from
    // another when every name is a hash
    expect(containersIn('app-abc123\tmy/app:latest\ndb-1\tpostgres:16\n')).toEqual([
      {name: 'app-abc123', image: 'my/app:latest'},
      {name: 'db-1', image: 'postgres:16'},
    ])

    // kubectl separates columns with spaces, and its header is not a container
    expect(containersIn('NAME   IMAGE\npod-1  nginx\n')).toEqual([{name: 'pod-1', image: 'nginx'}])

    // an engine that answered nothing is a machine with nothing running
    expect(containersIn('')).toEqual([])
    expect(containersIn(null)).toEqual([])
    expect(containerList('nonsense')).toBe('')
  })

  // a deployed project sits wherever its image put it, so its path is found
  // rather than guessed, and only what can be recognized is offered
  test('offers the directories that look like a project, without repeats', () => {
    expect(projectDirsIn('/var/www/html\n/srv/app\n/var/www/html\n')).toEqual(['/srv/app', '/var/www/html'])
    expect(projectDirsIn('')).toEqual([])

    // the question is asked of php, in the container, and it is one word to it
    const question = projectDirsCommand('/var/www/html')

    expect(question).toContain('composer.json')
    expect(question).toContain('artisan')
    expect(question.startsWith('php -r ')).toBe(true)
  })

  // every installed package has a composer.json of its own: a project with a
  // vendor directory is one project, not a hundred
  test('finds the project and not the packages it installed', () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const {execSync} = require('child_process')

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-dirs-'))
    const touch = file => {
      fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
      fs.writeFileSync(path.join(root, file), '{}')
    }

    touch('app/artisan')
    touch('app/vendor/laravel/framework/composer.json')
    touch('app/node_modules/pkg/composer.json')
    touch('srv/api/composer.json')

    try {
      const answer = execSync(projectDirsCommand(root), {encoding: 'utf8'})

      expect(projectDirsIn(answer)).toEqual([path.join(root, 'app'), path.join(root, 'srv/api')])
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  test('knows whether a project is in a container, on either machine', () => {
    expect(inContainer({container_engine: 'docker'})).toBe(true)
    expect(inContainer({is_over_ssh: true, container_engine: 'podman'})).toBe(true)
    expect(inContainer({container_engine: '  '})).toBe(false)
    expect(inContainer({is_over_ssh: true})).toBe(false)
    expect(inContainer(null)).toBe(false)
  })

  test('offers the engines the app builds for', () => {
    expect(engineNames).toEqual(['docker', 'podman', 'sail', 'kubectl'])
  })
})

// a pod is not always the one the current context reaches: it can be in another
// namespace, in another cluster, from a kubeconfig that is not the default one,
// and in one of a pod's several containers. Each of the connection's four fields
// is one of those, and a field left empty is a flag left out
describe('a pod connection that names where its pod is', () => {
  const pod = extra => Object.assign({container_engine: 'kubectl', container_name: 'api-7f9'}, extra)

  test('carries every flag, in kubectl\'s own order', () => {
    expect(containerCommand(pod({
      kube_config: '/home/me/.kube/prod.yaml',
      kube_context: 'prod-eu',
      kube_namespace: 'production',
      kube_container: 'php',
    })))
      .toBe('kubectl --kubeconfig /home/me/.kube/prod.yaml --context prod-eu exec -it -n production -c php api-7f9 -- php artisan tinker')

    // the file and the context come before the verb, the namespace and the
    // container after it: the two pairs are not on the same side of `exec`
    expect(containerCommand(pod({kube_namespace: 'production'})))
      .toBe('kubectl exec -it -n production api-7f9 -- php artisan tinker')
    expect(containerCommand(pod({kube_container: 'php'})))
      .toBe('kubectl exec -it -c php api-7f9 -- php artisan tinker')
  })

  // the bug this waits against: a pod outside the current namespace, or in
  // another cluster, was unreachable — the flag it needed was never built
  test('is the line it was before when the pod is the current context\'s own', () => {
    expect(containerCommand(pod())).toBe('kubectl exec -it api-7f9 -- php artisan tinker')
    // and a field that is only whitespace is a field that is not there
    expect(containerCommand(pod({kube_config: '  ', kube_context: '', kube_namespace: ' ', kube_container: '\t'})))
      .toBe('kubectl exec -it api-7f9 -- php artisan tinker')
  })

  test('quotes every value as one word of the shell that reads the line', () => {
    // a posix shell reads the value between quotes as it is, so a namespace with
    // a space in it stays one word
    expect(containerCommand(pod({kube_namespace: 'a b', kube_context: 'prod eu'})))
      .toBe("kubectl --context 'prod eu' exec -it -n 'a b' api-7f9 -- php artisan tinker")

    // a value that holds a quote is still one word, in each shell's own way
    expect(containerCommand(pod({kube_container: "it's"})))
      .toBe("kubectl exec -it -c 'it'\\''s' api-7f9 -- php artisan tinker")
    // a cmd word is the form the program reads with a caret before every
    // character cmd acts on, the form's own quotes included (see shell.cmdQuote)
    expect(containerCommand(pod({kube_namespace: 'my ns', kube_container: "it's"}), 'win32'))
      .toBe('kubectl exec -it -n ^"my^ ns^" -c ^"it\'s^" api-7f9 -- php artisan tinker')

    // cmd expands a name between percents before it looks at quotes, so a path
    // holding one is caret-escaped rather than left to the environment
    expect(containerCommand(pod({kube_config: 'C:\\Users\\me\\.kube\\prod %USERNAME%.yaml'}), 'win32'))
      .toBe('kubectl --kubeconfig ^"C:\\Users\\me\\.kube\\prod^ ^%USERNAME^%.yaml^" exec -it api-7f9 -- php artisan tinker')

    // and an ssh line is read there rather than here, so its words stay posix
    // even in a windows app
    expect(containerCommand(Object.assign({is_over_ssh: true}, pod({kube_config: '/srv/kube config.yaml', kube_namespace: 'prod'})), 'win32'))
      .toBe("kubectl --kubeconfig '/srv/kube config.yaml' exec -it -n prod api-7f9 -- php artisan tinker")
  })

  // kubectl has no working-directory flag, so the directory is a `cd` inside the
  // pod — and the machine's `path` is not the pod's, because a pod's filesystem
  // is its image's
  test('cds inside the pod, and only into a directory the pod is said to have', () => {
    expect(containerCommand(pod({container_path: '/var/www/html', path: '/home/me/app'})))
      .toBe("kubectl exec -it api-7f9 -- sh -c 'cd /var/www/html && php artisan tinker'")
    // the machine's path is not a directory the image need have
    expect(containerCommand(pod({path: '/home/me/app'})))
      .toBe('kubectl exec -it api-7f9 -- php artisan tinker')

    // the payload is read by the pod's own `sh`, which is posix, while the word
    // the shell is given is quoted for the shell that reads the line
    expect(containerCommand(pod({container_path: '/srv/app'}), 'win32'))
      .toBe('kubectl exec -it api-7f9 -- sh -c ^"cd^ /srv/app^ ^&^&^ php^ artisan^ tinker^"')
    expect(containerCommand(pod({container_path: '/srv/my app', kube_namespace: 'a b'})))
      .toBe("kubectl exec -it -n 'a b' api-7f9 -- sh -c 'cd '\\''/srv/my app'\\'' && php artisan tinker'")
  })

  test('asks the pod for a read with the same flags', () => {
    const connection = pod({
      kube_config: '/home/me/.kube/prod.yaml',
      kube_context: 'prod-eu',
      kube_namespace: 'production',
      kube_container: 'php',
      container_path: '/var/www/html',
    })

    expect(containerRead(connection, 'php -r 1'))
      .toBe("kubectl --kubeconfig /home/me/.kube/prod.yaml --context prod-eu exec -i -n production -c php api-7f9 -- sh -c 'cd /var/www/html && php -r 1'")
    expect(containerRead(connection, 'php -r 1', 'win32'))
      .toBe('kubectl --kubeconfig /home/me/.kube/prod.yaml --context prod-eu exec -i -n production -c php api-7f9 -- sh -c ^"cd^ /var/www/html^ ^&^&^ php^ -r^ 1^"')

    // a pod's filesystem is its image's, so the machine's path is not a directory
    // the read is given: a pod that names none is read where it starts
    expect(containerRead(pod({path: '/home/me/app'}), 'php -r 1'))
      .toBe('kubectl exec -i api-7f9 -- php -r 1')
    expect(containerDir(pod({path: '/home/me/app'}))).toBe('')
    // and the engine with a flag for it still falls back to the machine's path
    expect(containerDir({container_engine: 'docker', path: '/srv/app'})).toBe('/srv/app')
  })

  test('lists the pods of the namespace and the cluster the connection names', () => {
    expect(containerList('kubectl', 'posix', pod({kube_namespace: 'production'})))
      .toBe("kubectl get pods -n production --no-headers -o custom-columns='NAME:.metadata.name,IMAGE:.spec.containers[0].image'")
    expect(containerList('kubectl', 'win32', pod({
      kube_config: '/c/kube/prod.yaml',
      kube_context: 'prod-eu',
      kube_namespace: 'production',
    })))
      .toBe('kubectl --kubeconfig /c/kube/prod.yaml --context prod-eu get pods -n production --no-headers -o custom-columns=^"NAME:.metadata.name^,IMAGE:.spec.containers^[0^].image^"')

    // a listing with nothing named is the one it always was
    expect(containerList('kubectl', 'posix', pod())).toBe(containerList('kubectl', 'posix'))
  })

  test('offers the contexts and the namespaces a pod can be in', () => {
    // the contexts are the file's, so the question names the file and not one of
    // the contexts in it
    expect(kubeContextsCommand({kube_config: '/c k/kube.yaml'}, 'posix'))
      .toBe("kubectl --kubeconfig '/c k/kube.yaml' config get-contexts -o name")
    expect(kubeContextsCommand()).toBe('kubectl config get-contexts -o name')

    // and the namespaces are the cluster's, which is the file and the context
    expect(kubeNamespacesCommand({kube_context: 'prod-eu'}, 'posix'))
      .toBe('kubectl --context prod-eu get namespaces -o name')

    // `-o name` prints a namespace as its kind and its name, and the name is what
    // `-n` takes; a context is printed as itself
    expect(kubeNamesIn('namespace/production\nnamespace/staging\nnamespace/production\n'))
      .toEqual(['production', 'staging'])
    expect(kubeNamesIn('dev\nprod\n')).toEqual(['dev', 'prod'])
    expect(kubeNamesIn('')).toEqual([])
    expect(kubeNamesIn(null)).toEqual([])
  })
})

// the same connection on a windows app: the engine's line is read by cmd, and the
// container's own `sh -c` payload is still read by a posix shell inside the image
describe('a container connection on a windows machine', () => {
  test('quotes the engine\'s line for cmd, and the container\'s own words for posix', () => {
    const connection = {
      container_engine: 'docker',
      container_name: 'my app',
      container_path: '/var/www/html',
    }

    // the name and the directory are words of cmd here: single quotes would not
    // quote anything, and the line would be `docker exec -it 'my` and no app
    expect(containerCommand(connection, 'win32'))
      .toBe('docker exec -it -w /var/www/html ^"my^ app^" php artisan tinker')

    // `-w` comes before the name, so the working directory is the engine's flag
    // and not a word of the command inside
    expect(containerCommand(Object.assign({}, connection, {container_path: 'C:\\srv\\my app'}), 'win32'))
      .toBe('docker exec -it -w ^"C:\\srv\\my^ app^" ^"my^ app^" php artisan tinker')
  })

  test('keeps the `cd` inside the container posix, and quotes only the way in', () => {
    const connection = {
      container_engine: 'docker',
      container_name: 'my app',
      container_path: '/var/www/html',
    }

    // the payload is read by `sh -c` in the container, so its `cd` is posix
    // quoted; the payload itself, and the name, are one word of cmd
    expect(containerRead(connection, 'php -r 1', 'win32'))
      .toBe('docker exec -i ^"my^ app^" sh -c ^"cd^ /var/www/html^ ^&^&^ php^ -r^ 1^"')

    // a quote inside the payload is escaped for cmd, and the container's sh still
    // reads one quote: the php code that reads a log keeps its own quotes
    expect(containerRead(connection, 'php -r "echo 1;"', 'win32'))
      .toBe('docker exec -i ^"my^ app^" sh -c ^"cd^ /var/www/html^ ^&^&^ php^ -r^ \\^"echo^ 1^;\\^"^"')
  })

  test('is quoted for the far shell when the container is on a server', () => {
    // an ssh line is typed into this machine's shell but read there, so the
    // container's words stay posix even in a windows app
    const connection = {
      is_over_ssh: true,
      container_engine: 'docker',
      container_name: 'my app',
      path: '/srv/my app',
    }

    expect(containerCommand(connection, 'win32'))
      .toBe("docker exec -it -w '/srv/my app' 'my app' php artisan tinker")
    expect(containerRead(connection, 'php -r 1', 'win32'))
      .toBe("docker exec -i 'my app' sh -c 'cd '\\''/srv/my app'\\'' && php -r 1'")
  })

  test('lists what the engine runs in the words of the shell that reads it', () => {
    expect(containerList('docker')).toBe("docker ps --format '{{.Names}}\t{{.Image}}'")
    expect(containerList('docker', 'win32')).toBe('docker ps --format ^"{{.Names}}\t{{.Image}}^"')
    expect(containerList('kubectl', 'win32'))
      .toBe('kubectl get pods --no-headers -o custom-columns=^"NAME:.metadata.name^,IMAGE:.spec.containers^[0^].image^"')
  })
})
