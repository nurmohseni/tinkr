const {Pty, withoutPager} = require('../Pty')

describe('test Pty', () => {
  test('constructor should be correctly', () => {
    const connection = 'connection'
    const p = new Pty(connection)

    expect(p.connection).toBe(connection)
    expect(p.pty).toBeNull()
  })

  test('starts the session with the psysh pager out of the way', () => {
    // psysh reads cli.pager before it looks for less, and a pager holds the pty,
    // so the value a run is wrapped in would never come back
    expect(withoutPager('php artisan tinker')).toBe('php -d cli.pager=cat artisan tinker')
    expect(withoutPager('  php artisan tinker')).toBe('  php -d cli.pager=cat artisan tinker')
    expect(withoutPager('php -d memory_limit=1G artisan tinker'))
      .toBe('php -d cli.pager=cat -d memory_limit=1G artisan tinker')
  })

  test('leaves a command it cannot put an ini setting into alone', () => {
    expect(withoutPager('php8.2 artisan tinker')).toBe('php8.2 artisan tinker')
    expect(withoutPager('./vendor/bin/tinker')).toBe('./vendor/bin/tinker')
    expect(withoutPager('cd app && php artisan tinker')).toBe('cd app && php artisan tinker')
    expect(withoutPager('')).toBe('')
  })
})
