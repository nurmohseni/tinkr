import {containerCommand, appPlatform} from '../containerCommand'

// the main process builds the same command from the same fields (see
// tinkr-core/src/containerCommand.js): a form that built one command and a run
// that read another would be a connection that does nothing. The renderer has
// no core to import at runtime — no node, no `process`, and core reaches
// node-pty — so the quoting rule is mirrored here and this test is what keeps
// the two copies from drifting: every case is built by both, on both platforms,
// and the strings have to be equal
const {containerCommand: fromCore} = require('../../../../tinkr-core/src/containerCommand')

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
  // what a form is for: names and paths people really type, and the characters
  // that mean something to one shell and not the other
  {container_engine: 'docker', container_name: 'my "app" & co', container_path: '/var/www/my app'},
  {container_engine: 'docker', container_name: '100%app', container_path: 'C:\\srv\\100%'},
  {container_engine: 'docker', container_name: 'it\'s here', container_path: '/srv/it\'s here'},
  {container_engine: 'podman', container_name: 'app\\', path: '/srv/app\\'},
  {container_engine: 'docker', container_name: 'a^b!c', container_path: 'C:\\srv\\a^b!c'},
  // a container on a server: the line is read by the far login shell, so its
  // words stay posix even in a windows app
  {is_over_ssh: true, container_engine: 'docker', container_name: 'my app', path: '/srv/my app'},
  {is_over_ssh: true, container_engine: 'kubectl', container_name: 'pod/app', path: '/srv/app'},
]

describe.each(['linux', 'win32'])('the command a container connection starts with, on %s', platform => {
  test.each(cases)('is the one the main process builds from %o', connection => {
    expect(containerCommand(connection, platform)).toBe(fromCore(connection, platform))
  })
})

test('names the container rather than defaulting to one', () => {
  expect(containerCommand({container_engine: 'docker', container_name: ''})).toBe('')
})

// the renderer has no `process`: the machine comes over the bridge the preload
// installs, which is the only way the form knows to quote a name for cmd
test('reads the machine from the bridge, and a page without one is posix', () => {
  window.api.platform = 'win32'

  try {
    expect(appPlatform()).toBe('win32')
    expect(containerCommand({container_engine: 'docker', container_name: 'my app'}))
      .toBe('docker exec -it "my app" php artisan tinker')
    // and an ssh connection is still quoted for the far shell there
    expect(containerCommand({
      is_over_ssh: true,
      container_engine: 'docker',
      container_name: 'my app',
    })).toBe("docker exec -it 'my app' php artisan tinker")
  } finally {
    delete window.api.platform
  }

  // the test setup's bridge answers a function where a platform goes, and a page
  // opened outside the app has no bridge at all: neither is a windows machine
  expect(appPlatform()).toBe('posix')
  expect(containerCommand({container_engine: 'docker', container_name: 'my app'}))
    .toBe("docker exec -it 'my app' php artisan tinker")
})
