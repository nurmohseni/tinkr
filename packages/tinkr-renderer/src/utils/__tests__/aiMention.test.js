const {mentionAt, withMention} = require('../aiMention')

describe('the `@` of a prompt', () => {
  test('is what is being typed at the end of it', () => {
    expect(mentionAt('@')).toEqual({typed: '', at: 0})
    expect(mentionAt('what does @App')).toEqual({typed: 'App', at: 10})
    expect(mentionAt('look at @App\\Models\\User')).toEqual({typed: 'App\\Models\\User', at: 8})
    // what is written after a space or a bracket is a mention too
    expect(mentionAt('(see @Ord')).toEqual({typed: 'Ord', at: 5})
  })

  test('is not a mention once something else follows it', () => {
    expect(mentionAt('what does @App do?')).toBe(null)
    expect(mentionAt('@App\\Models\\User and then')).toBe(null)
    expect(mentionAt('')).toBe(null)
    expect(mentionAt(undefined)).toBe(null)
  })

  test('is not an email address', () => {
    expect(mentionAt('write to ada@example.com')).toBe(null)
    expect(mentionAt('write to ada@')).toBe(null)
  })
})

describe('naming a file in a prompt', () => {
  const file = {name: 'User', qualified: 'App\\Models\\User'}

  test('writes the whole name where the `@` was being written', () => {
    expect(withMention('@User', {typed: 'User', at: 0}, file)).toBe('@App\\Models\\User ')
    expect(withMention('what does @Us', {typed: 'Us', at: 10}, file))
      .toBe('what does @App\\Models\\User ')
    expect(withMention('@A please', {typed: 'A', at: 0}, file))
      .toBe('@App\\Models\\User  please')
  })

  test('keeps what was written before the mention', () => {
    expect(withMention('read @App\\Models\\Us and tell me', {typed: 'App\\Models\\Us', at: 5}, file))
      .toBe('read @App\\Models\\User  and tell me')
  })
})
