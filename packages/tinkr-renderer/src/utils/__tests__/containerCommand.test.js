import {containerCommand} from '../containerCommand'

// the main process builds the same command from the same fields (see
// tinkr-core/src/containerCommand.js): a form that built one command and a run
// that read another would be a connection that does nothing
const {containerCommand: fromCore} = require('../../../../tinkr-core/src/containerCommand')

describe('the command a container connection starts with', () => {
  const cases = [
    {container_engine: 'docker', container_name: 'app'},
    {container_engine: 'podman', container_name: 'laravel.test', container_command: 'php artisan tinker'},
    {container_engine: 'sail', container_name: 'laravel.test'},
    {container_engine: 'kubectl', container_name: 'pod/app'},
    {container_engine: 'docker', container_name: 'my app'},
    {container_engine: 'docker', container_name: ''},
    {container_engine: 'nonsense', container_name: 'app'},
    // the directory is the part the two copies are most likely to drift on: it
    // is the container's own path, and every engine spells it differently
    {container_engine: 'docker', container_name: 'app', path: '/var/www/html'},
    {container_engine: 'podman', container_name: 'app', path: '/srv/app', container_path: '/var/www/html'},
    {container_engine: 'sail', container_name: 'laravel.test', path: '/srv/app'},
    {container_engine: 'kubectl', container_name: 'pod/app', path: '/srv/app'},
  ]

  test.each(cases)('is the one the main process builds from %o', connection => {
    expect(containerCommand(connection)).toBe(fromCore(connection))
  })

  test('names the container rather than defaulting to one', () => {
    expect(containerCommand({container_engine: 'docker', container_name: ''})).toBe('')
  })
})
