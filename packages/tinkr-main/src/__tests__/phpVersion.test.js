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
  beforeEach(() => {
    mockConnect.mockClear()
  })

  test('is the one its own command names, not whatever php is on the path', () => {
    // a connection that starts a versioned php, a php with flags, or a php by
    // its full path runs that php, and the version it reports is its own
    expect(phpBinaryOf({command: 'php artisan tinker'})).toBe('php')
    expect(phpBinaryOf({command: 'php83 artisan tinker'})).toBe('php83')
    expect(phpBinaryOf({command: 'php8.3 artisan tinker'})).toBe('php8.3')
    expect(phpBinaryOf({command: 'php -d memory_limit=1G artisan tinker'})).toBe('php -d memory_limit=1G')
    expect(phpBinaryOf({command: 'php -dmemory_limit=1G -a'})).toBe('php -dmemory_limit=1G -a')
    expect(phpBinaryOf({command: '/usr/local/bin/php artisan tinker'})).toBe('/usr/local/bin/php')
    expect(phpBinaryOf({command: 'php -c /etc/php.ini artisan tinker'})).toBe('php -c /etc/php.ini')
  })

  test('keeps the words before the php word, because they are what reaches it', () => {
    // `docker exec app php` is not `php` on this machine: the exec and the
    // container name are part of the line that answers, so they are kept
    expect(phpBinaryOf({command: 'docker exec app php artisan tinker'})).toBe('docker exec app php')
    expect(phpBinaryOf({command: 'docker exec -it app php83 artisan tinker'})).toBe('docker exec -it app php83')
    expect(phpBinaryOf({command: 'lerd php -d x=1 artisan tinker'})).toBe('lerd php -d x=1')
    expect(phpBinaryOf({command: 'ssh host php artisan tinker'})).toBe('ssh host php')
  })

  test('is the container command for a container connection', () => {
    // the session builds the exec from the container's own command and ignores
    // the connection's command, so the badge has to read the same one
    expect(phpBinaryOf({
      container_engine: 'docker',
      container_name: 'app',
      container_command: 'php83 artisan tinker',
      command: 'php artisan tinker',
    })).toBe('php83')

    // a container with nothing stored for inside it runs the default
    expect(phpBinaryOf({container_engine: 'docker', container_name: 'app'})).toBe('php')
  })

  test('is nothing at all for a command that names no php', () => {
    // these reach their php through a wrapper that is not spelled php, and no
    // prefix of them can ask that php for a version
    expect(phpBinaryOf({command: 'sail artisan tinker'})).toBeNull()
    expect(phpBinaryOf({command: './vendor/bin/sail tinker'})).toBeNull()
  })

  test('falls back to the plain question when nothing names a command', () => {
    expect(phpBinaryOf({})).toBe('php')
    expect(phpBinaryOf({command: ''})).toBe('php')
  })

  // a deployed container's host need not have php at all: asking the host
  // reported "no php" while tinker ran fine inside the container
  test('is asked inside the container, not on the machine that runs it', () => {
    const win = {isDestroyed: () => false, webContents: {send: jest.fn()}}

    detectPhpVersion({
      is_over_ssh: true,
      container_engine: 'docker',
      container_name: 'app-1',
      container_path: '/app',
      container_command: 'php83 artisan tinker',
    }, win)
    detectPhpVersion({command: 'php artisan tinker'}, win)

    expect(mockConnect.mock.calls).toEqual([
      ["docker exec -i app-1 sh -c 'cd /app && php83 -v'"],
      ['php -v'],
    ])
  })

  test('is asked through the same wrapper the command uses', () => {
    const win = {isDestroyed: () => false, webContents: {send: jest.fn()}}

    detectPhpVersion({command: 'lerd php -d x=1 artisan tinker'}, win)
    detectPhpVersion({command: 'docker exec -it app php83 artisan tinker'}, win)

    expect(mockConnect.mock.calls).toEqual([
      ['lerd php -d x=1 -v'],
      ['docker exec -it app php83 -v'],
    ])
  })

  test('is asked on the far side of an ssh connection', () => {
    // the ssh line is built around whatever command the session is given, so
    // the question keeps the connection's own command words and nothing else
    const win = {isDestroyed: () => false, webContents: {send: jest.fn()}}

    detectPhpVersion({is_over_ssh: true, command: 'php8.3 artisan tinker'}, win)

    expect(mockConnect.mock.calls).toEqual([['php8.3 -v']])
  })

  test('is not asked at all when the command names no php', () => {
    // nothing is asked, and the window is told that the version is not
    // knowable rather than that the connection has no php
    const win = {isDestroyed: () => false, webContents: {send: jest.fn()}}

    detectPhpVersion({command: './vendor/bin/sail tinker'}, win)

    expect(mockConnect).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('phpVersion', {version: null, unknown: true})
  })
})
