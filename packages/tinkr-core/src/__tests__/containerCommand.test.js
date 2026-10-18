const {containerCommand, connectionKind, engineNames} = require('../containerCommand')

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
    expect(connectionKind({is_over_ssh: true, container_engine: 'docker'})).toBe('ssh')
    expect(connectionKind({})).toBe('local')
  })

  test('offers the engines the app builds for', () => {
    expect(engineNames).toEqual(['docker', 'podman', 'sail', 'kubectl'])
  })
})
