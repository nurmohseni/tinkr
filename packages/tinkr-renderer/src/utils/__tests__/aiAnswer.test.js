import {parseAnswer} from '../aiAnswer'

describe('test parseAnswer', () => {
  test('should take the code out of an answer that proposes some', () => {
    const answer = [
      'Here is a snippet that dumps the config keys.',
      '',
      '```php',
      'dump(array_keys(config(\'app\')));',
      '```',
      '',
      'It prints one key per line.',
    ].join('\n')

    expect(parseAnswer(answer)).toEqual({
      text: 'Here is a snippet that dumps the config keys.\n\nIt prints one key per line.',
      code: 'dump(array_keys(config(\'app\')));',
    })
  })

  test('should read an answer with no block as words alone', () => {
    const answer = 'That snippet returns the first user as an Eloquent model, or null.'

    expect(parseAnswer(answer)).toEqual({text: answer, code: null})
  })

  test('should read a block that is the whole answer', () => {
    expect(parseAnswer('```php\n$a = 1;\n```')).toEqual({text: '', code: '$a = 1;'})
  })

  test('should read a block with no language on it', () => {
    expect(parseAnswer('```\n$a = 1;\n```')).toEqual({text: '', code: '$a = 1;'})
  })

  test('should refuse a block that was never closed, and drop the fence it opened', () => {
    const answer = 'Here it is.\n\n```php\ndump($a);'

    expect(parseAnswer(answer)).toEqual({text: 'Here it is.\n\ndump($a);', code: null})
  })

  test('should take the whole snippet, however many lines it has', () => {
    const code = '$users = App\\Models\\User::all();\n\nforeach ($users as $user) {\n    dump($user->name);\n}'

    expect(parseAnswer('```php\n' + code + '\n```').code).toBe(code)
  })
})
