const {typeAt, localsAt, tokensFor} = require('../typeInference')

// A project small enough to hold in a test: the members the cases below ask
// for, and nothing else, so a type that is not in here is an unknown type.
const user = {name: 'App\\Models\\User'}
const order = {name: 'App\\Models\\Order'}
const builder = {name: 'Illuminate\\Database\\Eloquent\\Builder'}
const collection = {name: 'Illuminate\\Support\\Collection'}
const eloquentCollection = {name: 'Illuminate\\Database\\Eloquent\\Collection', item: 'App\\Models\\User'}
const carbon = {name: 'Carbon\\Carbon'}
const post = {name: 'App\\Models\\Post'}
const posts = {name: 'Illuminate\\Database\\Eloquent\\Collection', item: 'App\\Models\\Post'}

const classes = {
  User: 'App\\Models\\User',
  Order: 'App\\Models\\Order',
  Post: 'App\\Models\\Post',
  Builder: 'Illuminate\\Database\\Eloquent\\Builder',
  Collection: 'Illuminate\\Support\\Collection',
  Cache: 'Illuminate\\Support\\Facades\\Cache',
  RuntimeException: 'RuntimeException',
  static: null,
  self: null,
}

const returns = {
  '::App\\Models\\User::first': user,
  '::App\\Models\\User::find': user,
  '::App\\Models\\User::create': user,
  '::App\\Models\\User::where': builder,
  '::App\\Models\\User::count': {scalar: 'int'},
  '::Illuminate\\Support\\Facades\\Cache::get': null,
  '->App\\Models\\User::where': builder,
  '->App\\Models\\User::save': {scalar: 'bool'},
  '->Illuminate\\Database\\Eloquent\\Builder::where': builder,
  '->Illuminate\\Database\\Eloquent\\Builder::orderBy': builder,
  '->Illuminate\\Database\\Eloquent\\Builder::first': user,
  '->Illuminate\\Database\\Eloquent\\Builder::get': eloquentCollection,
  '->Illuminate\\Database\\Eloquent\\Builder::count': {scalar: 'int'},
  '->Illuminate\\Support\\Collection::map': collection,
  '->Illuminate\\Support\\Collection::first': user,
  '->Carbon\\Carbon::addDay': carbon,
}

const properties = {
  'App\\Models\\User::name': {scalar: 'string'},
  'App\\Models\\User::email_verified_at': carbon,
  'App\\Models\\User::posts': posts,
  'App\\Models\\Order::total': {scalar: 'float'},
  'Carbon\\Carbon::day': {scalar: 'int'},
}

const functions = {
  now: carbon,
  today: carbon,
  collect: collection,
}

const key = (type, member, isStatic) => `${isStatic ? '::' : '->'}${type && type.name}::${member}`

const resolver = {
  resolveName: written => {
    const clean = written.replace(/^\\+/, '')

    // a name that already says where it is lives there
    if (clean.includes('\\')) {
      return clean
    }

    return classes[clean] || null
  },
  returnOf: (type, member, {static: isStatic = false} = {}) => returns[key(type, member, isStatic)] || null,
  propertyType: (type, name) => properties[`${type && type.name}::${name}`] || null,
  functionReturn: name => functions[name] || null,
}

// the caret always sits at the end of these snippets, which is where an
// editor asks
const at = code => typeAt(code, code.length, resolver)

describe('the type of the expression at the caret', () => {
  test('the cases a popup has to answer', () => {
    const cases = [
      ['$u = User::first(); $u->', user],
      ['User::find(1)->', user],
      ['User::where(\'id\', 1)->first()->', user],
      ['User::where(\'id\', 1)->', builder],
      ['User::where(\'id\', 1)->where(\'a\', 1)->orderBy(\'id\')->', builder],
      ['User::where(\'id\', 1)->get()->', eloquentCollection],
      ['collect([])->', collection],
      ['collect([1, 2])->', collection],
      ['now()->', carbon],
      ['today()->', carbon],
      ['$x = Cache::get(\'x\'); $x->', null],
      ['new User()->', user],
      ['(new User)->', user],
      ['/** @var Order $o */ $o->', order],
      ['$x->', null],
      ['$u = User::first(); $u->where(\'a\', 1)->get()->', eloquentCollection],
      ['User::count()', {scalar: 'int'}],
      ['$u = User::first(); $u->name', {scalar: 'string'}],
      ['$u = User::first(); $u->email_verified_at->addDay()->', carbon],
      ['$u = User::first(); $u?->posts', posts],
      ['$o = new Order(); $o->total', {scalar: 'float'}],
      ['User::create([\'name\' => \'x\'])->', user],
      ['$u = User::first(); $u->save()', {scalar: 'bool'}],
      ['$u = User::first(); $u->posts->', posts],
      ['$s = $a . ($b); $s->', {scalar: 'string'}],
      ['$u = User::first(); $u->', user],
    ]

    for (const [code, expected] of cases) {
      expect([code, at(code)]).toEqual([code, expected])
    }
  })

  test('a re-assignment answers with the latest type before the caret', () => {
    expect(at('$x = User::first(); $x = new Order(); $x->')).toEqual(order)
    expect(at('$x = new Order(); $x = User::first(); $x->')).toEqual(user)
  })

  test('a chain keeps its item through an index', () => {
    expect(at('$orders = User::where(\'a\', 1)->get(); $orders[0]->')).toEqual(user)
  })

  test('foreach binds the item of what it walks, the key and the value apart', () => {
    const walked = '$users = User::where(\'a\', 1)->get(); foreach ($users as $user) { $user->'
    const keyed = '$orders = new Order(); foreach ($orders as $k => $v) { $v->'

    expect(at(walked)).toEqual(user)
    expect(at(keyed)).toEqual(null)
    expect(at('$u = User::first(); foreach ($u->posts as $post) { $post->')).toEqual(post)
    expect(at('foreach ($post->id as $id) { }')).toEqual(null)
  })

  test('catch, closure parameters and fn bind their declared types', () => {
    expect(at('try { User::first(); } catch (RuntimeException $e) { $e->')).toEqual({name: 'RuntimeException'})
    expect(at('try { User::first(); } catch (RuntimeException|Exception $e) { $e->')).toEqual(null)
    expect(at('array_map(function (User $user) { $user->')).toEqual(user)
    expect(at('array_map(fn (Order $order) => $order->')).toEqual(order)
    expect(at('$f = function (User $user) { return $user; }; $f();')).toEqual(null)
  })

  test('a @var tag names a type an assignment does not', () => {
    expect(at('/** @var Order $o */ $o->')).toEqual(order)
    expect(at('/* @var Order $o */\n$o->')).toEqual(order)
    expect(at('// @var Order $o\n$o->')).toEqual(order)
    expect(at('/** @var Order|Invoice $o */ $o->')).toEqual(null)
    expect(at('$o = []; /** @var Order[] $o */ foreach ($o as $one) { $one->')).toEqual(null)
  })

  test('strings, comments and heredocs are text, not code', () => {
    expect(at('$x = \'User::first()->\'; $x->')).toEqual(null)
    expect(at('// User::first()->')).toEqual(null)
    expect(at('/* $u = User::first(); $u-> */')).toEqual(null)
    expect(at('$x = <<<SQL\nUser::first()->\nSQL;\n$x->')).toEqual(null)
    expect(at('$x = \'/** @var Order $o */\'; $o->')).toEqual(null)
    expect(at("$x = <<<'TXT'\n// @var Order $o\nTXT;\n$o->")).toEqual(null)
  })

  test('an unknown receiver is null rather than a guess', () => {
    expect(at('$whatever->')).toEqual(null)
    expect(at('$x = unknownFunction(); $x->')).toEqual(null)
    expect(at('User::query()->get();')).toEqual(null)
    expect(at('$x = (int) User::first(); $x->')).toEqual({scalar: 'int'})
    expect(at('$s = $a . $b; $s->')).toEqual({scalar: 'string'})
    expect(at('$x = 4.5; $x->')).toEqual({scalar: 'float'})
  })

  test('static and self are resolved by the caller, never by this module', () => {
    expect(at('static::first()->')).toEqual(null)
    expect(at('self::first()->')).toEqual(null)
    expect(at('User::class')).toEqual({scalar: 'string'})
  })

  test('a cast wins over the value it is written in front of', () => {
    expect(at('$n = (int) $x; $n->')).toEqual({scalar: 'int'})
    expect(at('$u = User::first(); $n = (string) $u; $n->')).toEqual({scalar: 'string'})
    expect(at('$n = User::count(); $n->')).toEqual({scalar: 'int'})
  })

  test('garbage is an empty answer and never a throw', () => {
    expect(at('')).toEqual(null)
    expect(at(')))>>::')).toEqual(null)
    expect(at('::::')).toEqual(null)
    expect(at('->->->')).toEqual(null)
    expect(at('$')).toEqual(null)
    expect(at('(((((')).toEqual(null)
    expect(at('<<<')).toEqual(null)
    expect(typeAt(null, 0, resolver)).toEqual(null)
    expect(typeAt('$u = User::first(); $u->', -1, resolver)).toEqual(user)
    expect(typeAt('$u = User::first(); $u->', 100, resolver)).toEqual(user)
    expect(typeAt('$u = User::first(); $u->', 19, {})).toEqual(null)
    expect(typeAt('$u = User::first(); $u->', 19, {resolveName: () => { throw new Error('nope') }})).toEqual(null)
    expect(typeAt('$u = User::first(); $u->', 19, {resolveName: () => 'App\\Models\\User', returnOf: () => { throw new Error('nope') }})).toEqual(null)
  })

  test('the tokens keep their offsets, so the caret can be anywhere', () => {
    const code = '$u = User::first(); $u->where(\'a\', 1)->'

    expect(tokensFor(code).slice(0, 3)).toEqual([
      {type: 'var', text: '$u', start: 0},
      {type: 'symbol', text: '=', start: 3},
      {type: 'name', text: 'User', start: 5},
    ])
    // inside `where`, the receiver is still the model
    expect(typeAt(code, code.indexOf('where') + 2, resolver)).toEqual(user)
  })
})

describe('the variables the snippet declares', () => {
  test('names them without their dollar, in the order they are bound', () => {
    const code = '$a = User::first(); $b = new Order(); $c = Cache::get(\'x\'); $a->'

    expect(localsAt(code, code.length, resolver)).toEqual([
      {name: 'a', type: user},
      {name: 'b', type: order},
      {name: 'c', type: null},
    ])
  })

  test('counts a foreach, a catch, a parameter and a @var tag', () => {
    const code = 'foreach ($users as $user) { $user-> } catch (RuntimeException $e) {}'

    expect(localsAt(code, code.length, resolver)).toEqual([
      {name: 'user', type: null},
      {name: 'e', type: {name: 'RuntimeException'}},
    ])
    expect(localsAt('try {} catch (RuntimeException $e) { $e->', 37, resolver)).toEqual([{name: 'e', type: {name: 'RuntimeException'}}])
    expect(localsAt('array_map(function (User $user) { $user->', 40, resolver)).toEqual([{name: 'user', type: user}])
    expect(localsAt('/** @var Order $o */ $o->', 26, resolver)).toEqual([{name: 'o', type: order}])
  })

  test('nothing for an empty snippet or a snippet with no variables', () => {
    expect(localsAt('', 0, resolver)).toEqual([])
    expect(localsAt('User::first();', 14, resolver)).toEqual([])
    expect(localsAt(null, 0, resolver)).toEqual([])
  })
})

describe('the cost of one lookup', () => {
  const line = '$user = User::where(\'active\', 1)->orderBy(\'id\')->first(); $user->email_verified_at->addDay();\n'

  const snippet = bytes => line.repeat(Math.ceil(bytes / line.length)) + '$user->'

  // the median of a handful of runs, after one warm run so the token regex is
  // already compiled: an editor pays for the work, not for the first call, and
  // a scheduler hiccup on a loaded machine moves the odd run, never the median
  const medianOf = (run, runs = 9) => {
    run()

    const times = []

    for (let attempt = 0; attempt < runs; attempt++) {
      const start = performance.now()

      run()
      times.push(performance.now() - start)
    }

    times.sort((a, b) => a - b)

    return times[Math.floor(times.length / 2)]
  }

  test('fits in the time a keystroke has', () => {
    const code = snippet(20480)

    expect(code.length).toBeGreaterThan(20000)

    // a ceiling, not a benchmark: far above what the lookup costs on an idle
    // machine, far below what an accidental quadratic path would cost
    expect(medianOf(() => typeAt(code, code.length, resolver))).toBeLessThan(50)
  })

  test('costs no more than linearly in the size of the snippet', () => {
    const small = snippet(20480)
    const large = snippet(81920)

    const fast = medianOf(() => typeAt(small, small.length, resolver))
    const slow = medianOf(() => typeAt(large, large.length, resolver))

    // four times the text for well under eight times the work; a quadratic
    // path would show up here as sixteen. The floor keeps timer noise on a
    // very fast machine from deciding the comparison.
    expect(slow).toBeLessThan(Math.max(fast * 8, 15))
  })
})
