const {stringContextAt} = require('../stringContexts')

// the caret at the end of what has been typed, which is where a suggestion is
// asked for
const at = code => stringContextAt(code, code.length)

describe('the string a snippet types a name into', () => {
  test('reads the first argument of every call that takes a name', () => {
    const cases = [
      ["config('app.ti", 'config'],
      ["Config::get('app.ti", 'config'],
      ["\\config('app.ti", 'config'],
      ["route('admin.us", 'route'],
      ["URL::route('admin.us", 'route'],
      ["Route::has('admin.us", 'route'],
      ["redirect()->route('admin.us", 'route'],
      ["view('mail.we", 'view'],
      ["View::make('mail.we", 'view'],
      ["env('DB_", 'env'],
      ["__('auth.fa", 'trans'],
      ["trans('auth.fa", 'trans'],
      ["trans_choice('apples", 'trans'],
      ["Lang::get('auth.fa", 'trans'],
      ["app('cache", 'binding'],
      ["resolve('db", 'binding'],
      ["App::make('queue", 'binding'],
      ["app()->make('queue", 'binding'],
    ]

    for (const [code, kind] of cases) {
      const context = at(code)

      expect([code, context && context.kind]).toEqual([code, kind])
    }
  })

  test('says where the name starts and what is typed of it', () => {
    expect(at("config('app.ti")).toEqual({kind: 'config', prefix: 'app.ti', start: 8})
    expect(at("config('")).toEqual({kind: 'config', prefix: '', start: 8})
    // a double quote is a string too, and so is one that starts after a space
    expect(at('config("app.ti')).toEqual({kind: 'config', prefix: 'app.ti', start: 8})
    expect(at("config( 'app.ti")).toEqual({kind: 'config', prefix: 'app.ti', start: 9})
    expect(at("config(\n    'app.ti")).toEqual({kind: 'config', prefix: 'app.ti', start: 13})
  })

  test('reads the name the caret sits in the middle of', () => {
    // a suggestion is asked for wherever the caret is, not only at the end of
    // what has been typed
    expect(stringContextAt("config('app.timezone')", 12)).toEqual({kind: 'config', prefix: 'app.', start: 8})
  })

  test('answers nothing outside a first argument', () => {
    const cases = [
      // another call's arguments are not a config key or a route
      "str_replace('a', 'b",
      "array_merge(['a' => 'b'], [",
      // a second argument
      "config('app.timezone', 'b",
      "route('home', ['as' => 'x",
      // a string that is not an argument at all
      "'Teatro::wh",
      '$x = "a',
      // a name written in a string is a name, not a list
      "dump('config('",
      // a variable that holds a callable is not that function
      "$config('app.ti",
      // comments, heredocs and nowdocs hold no code
      "// config('app.ti",
      "  /* config('app.ti",
      "$x = <<<EOT\nconfig('app.ti\nEOT\n",
      "$x = <<<'EOT'\nconfig('app.ti\nEOT\n",
      // a call that takes no name of ours
      "Storage::disk('local",
      "cache('key",
      "logger('x",
    ]

    for (const code of cases) {
      const context = at(code)

      expect([code, context]).toEqual([code, null])
    }
  })

  test('answers nothing after the string has been closed', () => {
    expect(at("config('app.timezone')")).toBe(null)
    expect(at('$a = 1; $b = 2;')).toBe(null)
  })

  test('reads the snippet alone: an unclosed file is not an error', () => {
    expect(at("config('")).toEqual({kind: 'config', prefix: '', start: 8})
    expect(stringContextAt('', 0)).toBe(null)
    // an offset past the end is the end
    expect(stringContextAt("config('a", 99)).toEqual({kind: 'config', prefix: 'a', start: 8})
    expect(stringContextAt(null, 0)).toBe(null)
  })

  test('a call name in another string is not a call', () => {
    expect(at("$x = 'config('; route('home")).toEqual({kind: 'route', prefix: 'home', start: 23})
  })
})
