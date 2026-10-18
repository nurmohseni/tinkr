jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp'}}))
jest.mock('electron-store', () => class Store {
  get(key, fallback) { return fallback }
})

const {phpBinaryOf} = require('../services/phpVersion')

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
})
