const {
  containerCommand, sessionCommand, containerRead, containerPath, inContainer, connectionKind, engineNames,
  containerList, containersIn, projectDirsCommand, projectDirsIn,
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
