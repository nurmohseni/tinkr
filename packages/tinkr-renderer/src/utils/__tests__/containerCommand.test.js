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
  // the characters of both reading phases at once, in a value a form really
  // takes: a percent, a bang and a caret in one word, beside the quote and
  // apostrophe cmd has no rule for
  {container_engine: 'docker', container_name: 'a!b%c^d"e\'f,g;h', container_path: 'C:\\srv\\a!b%c^d'},
  // a container on a server: the line is read by the far login shell, so its
  // words stay posix even in a windows app
  {is_over_ssh: true, container_engine: 'docker', container_name: 'my app', path: '/srv/my app'},
  {is_over_ssh: true, container_engine: 'kubectl', container_name: 'pod/app', path: '/srv/app'},
  // a pod that names where it is: every flag, one of them alone, and none of
  // them, which has to read exactly as it did before the fields existed
  {container_engine: 'kubectl', container_name: 'api-7f9'},
  {container_engine: 'kubectl', container_name: 'api-7f9', kube_namespace: 'production'},
  {container_engine: 'kubectl', container_name: 'api-7f9', kube_container: 'php', kube_namespace: 'production'},
  {
    container_engine: 'kubectl',
    container_name: 'api-7f9',
    kube_config: '/home/me/.kube/prod.yaml',
    kube_context: 'prod-eu',
    kube_namespace: 'production',
    kube_container: 'php',
    container_path: '/var/www/html',
  },
  // a pod's directory is the only one it has: the machine's path is not one
  {container_engine: 'kubectl', container_name: 'api-7f9', path: '/home/me/app'},
  {container_engine: 'kubectl', container_name: 'api-7f9', container_path: '/srv/my app', kube_namespace: 'a b'},
  {container_engine: 'kubectl', container_name: 'api-7f9', kube_context: 'prod eu'},
  // the characters that mean something to one shell and not the other, in a
  // value kubectl takes as a word
  {container_engine: 'kubectl', container_name: 'api-7f9', kube_namespace: 'my ns', kube_container: 'it\'s'},
  {container_engine: 'kubectl', container_name: 'api-7f9', kube_config: 'C:\\Users\\me\\.kube\\prod %USERNAME%.yaml'},
  {container_engine: 'kubectl', container_name: 'a b', kube_context: "prod's", kube_namespace: '100%'},
  // an ssh line is read by the far login shell, so a pod's words stay posix
  // there whatever this machine is
  {is_over_ssh: true, container_engine: 'kubectl', container_name: 'api-7f9', kube_config: '/srv/kube config.yaml', kube_namespace: 'prod', container_path: '/srv/my app'},
  // and the flags are only kubectl's: another engine ignores them
  {container_engine: 'docker', container_name: 'app', kube_namespace: 'production'},
]

describe.each(['linux', 'win32'])('the command a container connection starts with, on %s', platform => {
  test.each(cases)('is the one the main process builds from %o', connection => {
    expect(containerCommand(connection, platform)).toBe(fromCore(connection, platform))
  })
})

// what the form builds for a pod, spelled out: a connection that names a
// namespace, a context, a kubeconfig and a container of the pod is a line kubectl
// reads, and the two copies agreeing on a wrong line would agree on nothing
test('names the pod the connection is about, in kubectl\'s own order', () => {
  const pod = {
    container_engine: 'kubectl',
    container_name: 'api-7f9',
    kube_config: '/home/me/.kube/prod.yaml',
    kube_context: 'prod-eu',
    kube_namespace: 'production',
    kube_container: 'php',
  }

  expect(containerCommand(pod, 'linux'))
    .toBe('kubectl --kubeconfig /home/me/.kube/prod.yaml --context prod-eu exec -it -n production -c php api-7f9 -- php artisan tinker')
  // a pod with no directory of its own runs where its image starts
  expect(containerCommand(Object.assign({}, pod, {path: '/home/me/app'}), 'linux'))
    .toBe('kubectl --kubeconfig /home/me/.kube/prod.yaml --context prod-eu exec -it -n production -c php api-7f9 -- php artisan tinker')
  // and one that names it is cd'd into inside the pod, by the pod's own shell
  expect(containerCommand(Object.assign({}, pod, {container_path: '/var/www/html'}), 'linux'))
    .toBe("kubectl --kubeconfig /home/me/.kube/prod.yaml --context prod-eu exec -it -n production -c php api-7f9 -- sh -c 'cd /var/www/html && php artisan tinker'")
  // a windows app quotes the word the pod's shell is given for cmd, and the
  // payload's own `cd` stays posix
  expect(containerCommand(Object.assign({}, pod, {container_path: '/var/www/html'}), 'win32'))
    .toBe('kubectl --kubeconfig /home/me/.kube/prod.yaml --context prod-eu exec -it -n production -c php api-7f9 -- sh -c ^"cd^ /var/www/html^ ^&^&^ php^ artisan^ tinker^"')

  expect(containerCommand({container_engine: 'kubectl', container_name: 'api-7f9'}, 'linux'))
    .toBe('kubectl exec -it api-7f9 -- php artisan tinker')
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
      .toBe('docker exec -it ^"my^ app^" php artisan tinker')
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
