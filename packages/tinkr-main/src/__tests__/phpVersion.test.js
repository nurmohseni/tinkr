jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp'}}))
jest.mock('electron-store', () => class Store {
  get(key, fallback) { return fallback }
})

const mockConnect = jest.fn()
jest.mock('../pty/Pty', () => ({
  Pty: class {
    connect(command) { mockConnect(command) }
    onData() { return {dispose() {}} }
    kill() {}
  },
}))

const {phpBinaryOf, detectPhpVersion} = require('../services/phpVersion')

describe('the php a connection runs', () => {
  test('is the one its own command names, not whatever php is on the path', () => {
    // a connection that starts a versioned php, a php with flags, or a php inside
    // a container runs that php, and the version it reports is its own
    expect(phpBinaryOf({command: 'php artisan tinker'})).toBe('php')
    expect(phpBinaryOf({command: 'php83 artisan tinker'})).toBe('php83')
    expect(phpBinaryOf({command: 'php8.3 artisan tinker'})).toBe('php8.3')
    expect(phpBinaryOf({command: 'php -d memory_limit=1G artisan tinker'})).toBe('php -d memory_limit=1G')
    expect(phpBinaryOf({command: 'php -dmemory_limit=1G -a'})).toBe('php -dmemory_limit=1G -a')
    expect(phpBinaryOf({command: 'docker exec app php artisan tinker'})).toBe('php')
    expect(phpBinaryOf({command: '/usr/local/bin/php artisan tinker'})).toBe('/usr/local/bin/php')
    expect(phpBinaryOf({command: 'php -c /etc/php.ini artisan tinker'})).toBe('php -c /etc/php.ini')
  })

  test('falls back to the plain question when the command names no php', () => {
    // a command whose php cannot be read from it is asked the only question there
    // is; the shell answers with what it has, or with nothing
    expect(phpBinaryOf({})).toBe('php')
    expect(phpBinaryOf({command: ''})).toBe('php')
    expect(phpBinaryOf({command: 'tail -f storage/logs/laravel.log'})).toBe('php')
  })

  // a deployed container's host need not have php at all: asking the host
  // reported "no php" while tinker ran fine inside the container
  test('is asked inside the container, not on the machine that runs it', () => {
    const win = {isDestroyed: () => false, webContents: {send: jest.fn()}}

    detectPhpVersion({is_over_ssh: true, container_engine: 'docker', container_name: 'app-1', container_path: '/app', command: 'php artisan tinker'}, win)
    detectPhpVersion({command: 'php artisan tinker'}, win)

    expect(mockConnect.mock.calls).toEqual([
      ["docker exec -i app-1 sh -c 'cd /app && php -v'"],
      ['php -v'],
    ])
  })
})
