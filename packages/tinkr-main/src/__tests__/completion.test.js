// a completion reads what the app has already read of the project, and a test has
// no project to read: the read is the recorded one under __fixtures__
jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp/tinkr-completion-test'}}))
jest.mock('../services/php', () => ({ask: jest.fn(async () => JSON.stringify(require('./__fixtures__/intel.json')))}))
// nothing a keystroke asks is a run: a machine that is reached here is a failure
// of the popup, not a slow one
jest.mock('../remote', () => ({exec: jest.fn(async () => { throw new Error('a keystroke reached the project') })}))

const fs = require('fs')
const os = require('os')
const path = require('path')

const {phpCompletions, phpSignature} = require('../completion')
const {refreshIntel, intelStatus} = require('../services/intel')
const {setEditorConnection} = require('../processes')
const {clearClassIndex, memberRanks} = require('tinkr-core')
const {ask} = require('../services/php')
const {exec} = require('../remote')

const labels = items => items.map(item => item.label)
const firsts = (items, count) => labels(items).slice(0, count)

/**
 * A project on disk with the classes a snippet can name: the popup offers the
 * project's own names by reading its composer file, and a name is offered with the
 * `use` statement that would import it.
 */
const project = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-completion-'))
  const models = path.join(root, 'app', 'Models')
  const support = path.join(root, 'app', 'Support')

  fs.mkdirSync(models, {recursive: true})
  fs.mkdirSync(support, {recursive: true})
  fs.mkdirSync(path.join(root, 'vendor', 'composer'), {recursive: true})
  fs.writeFileSync(path.join(root, 'composer.json'), JSON.stringify({autoload: {'psr-4': {'App\\': 'app/'}}}))
  // what composer writes: the map the popup reads a project's names from
  fs.writeFileSync(
    path.join(root, 'vendor', 'composer', 'autoload_psr4.php'),
    "<?php\n\n$baseDir = dirname(__DIR__, 2);\n\nreturn array(\n    'App\\\\' => array($baseDir . '/app'),\n);\n",
  )
  fs.writeFileSync(path.join(models, 'User.php'), '<?php\n\nnamespace App\\Models;\n\nclass User {}\n')
  fs.writeFileSync(path.join(support, 'Invoice.php'), '<?php\n\nnamespace App\\Support;\n\nclass Invoice {}\n')
  clearClassIndex()

  return root
}

const connection = {id: 'completion-test', name: 'Completion', type: 'local', path: project()}

// the completion of a snippet ending at the caret
const complete = code => phpCompletions(connection.id, {code, offset: code.length})

describe('the completion of a php snippet', () => {
  beforeAll(async () => {
    setEditorConnection(connection.id, connection)
    // the read the popup answers from, kept as the app keeps it: once per project
    await refreshIntel(connection)
  })

  beforeEach(() => {
    // the reads are counted per keystroke, not across the suite
    ask.mockClear()
    exec.mockClear()
  })

  describe('what a class offers on its own', () => {
    it('offers a model’s statics, and not the instance calls a class does not answer', async () => {
      const {items} = await complete('<?php User::')
      const shown = labels(items)

      expect(shown).toEqual(expect.arrayContaining(['where', 'first', 'find', 'create']))
      expect(shown).not.toContain('save')
      expect(shown).not.toContain('fill')
    })

    it('narrows to what has been typed', async () => {
      const {items} = await complete('<?php User::fir')

      expect(labels(items)).toContain('first')
      expect(labels(items)).not.toContain('where')
    })

    it('offers a query builder after a where', async () => {
      const {items} = await complete("<?php User::where('active', 1)->")

      expect(labels(items)).toEqual(expect.arrayContaining(['get', 'orderBy', 'paginate']))
    })

    it('offers a facade’s manager', async () => {
      expect(labels((await complete('<?php Cache::')).items)).toEqual(expect.arrayContaining(['remember', 'put']))
      expect(labels((await complete('<?php DB::')).items)).toEqual(expect.arrayContaining(['table', 'transaction']))
    })

    it('inserts a call with the arguments it requires', async () => {
      const {items} = await complete('<?php User::whe')
      const where = items.find(item => item.label === 'where')

      expect(where.insert).toContain('where(')
      expect(where.detail).toContain('where(')
      expect(where.type).toBe('method')
    })
  })

  describe('what a value offers', () => {
    it('offers a model’s columns in the order of its table', async () => {
      const {items} = await complete('<?php $user = User::first();\n$user->')

      expect(firsts(items, 3)).toEqual(['id', 'name', 'email'])
    })

    it('offers a collection’s calls', async () => {
      const {items} = await complete('<?php collect([])->')

      expect(labels(items)).toEqual(expect.arrayContaining(['map', 'filter']))
    })

    it('offers a date’s calls, including the ones carbon only documents', async () => {
      const {items} = await complete('<?php now()->')

      expect(labels(items)).toEqual(expect.arrayContaining(['addDays', 'format']))
    })

    it('answers nothing for a receiver it cannot type, rather than guessing', async () => {
      expect((await complete('<?php $unknown->')).items).toEqual([])
      expect((await complete('<?php $this->unknown()->')).items).toEqual([])
    })
  })

  describe('what a string argument holds', () => {
    it('offers config keys, and replaces what has been typed of one', async () => {
      const code = "<?php config('app.ti"
      const {items} = await complete(code)
      const key = items.find(item => item.label === 'app.timezone')

      expect(key).toBeDefined()
      expect(key.from).toBe(code.indexOf("'") + 1)
      expect(key.to).toBe(code.length)
    })

    it('offers routes, views and env names', async () => {
      expect((await complete("<?php route('")).items.length).toBeGreaterThan(0)
      expect((await complete("<?php view('")).items.length).toBeGreaterThan(0)
      expect(labels((await complete("<?php env('")).items)).toEqual(expect.arrayContaining(['APP_ENV']))
    })

    it('narrows a name to the part typed', async () => {
      const {items} = await complete("<?php config('app.ti")

      expect(items.every(item => item.label.startsWith('app.ti'))).toBe(true)
    })
  })

  describe('what the snippet itself holds', () => {
    it('offers its own variables, without the dollar the editor already typed', async () => {
      const {items} = await complete('<?php $user = User::first();\n$us')
      const local = items.find(item => item.label === '$user')

      expect(local).toBeDefined()
      expect(local.insert).toBe('user')
    })

    it('offers the functions the project can call', async () => {
      expect(labels((await complete('<?php str_')).items)).toEqual(expect.arrayContaining(['str_replace']))
    })

    it('offers a class name with the import it needs', async () => {
      const {items} = await complete('<?php User')
      const found = items.find(item => item.label === 'User')

      expect(found).toBeDefined()
      expect(found.import).toBe('App\\Models\\User')
      expect(found.type).toBe('class')
    })
  })

  describe('what nothing answers', () => {
    it('answers a caret with no name in front of it with nothing', async () => {
      expect((await complete('<?php ')).items).toEqual([])
      expect((await complete('<?php $')).items).toEqual([])
    })

    it('answers a class the read does not hold with nothing, and reads it behind the keystroke', async () => {
      const {items} = await complete('<?php \\App\\Nowhere::')

      expect(items).toEqual([])
    })
  })

  describe('the signature of the call the caret is in', () => {
    it('reads a static call’s parameters', () => {
      const code = '<?php User::where('
      const answer = phpSignature(connection.id, {code, offset: code.length})

      expect(answer.label).toContain('where(')
      expect(answer.parameters.map(parameter => parameter.label)).toEqual(expect.arrayContaining([expect.stringContaining('$column')]))
      expect(answer.activeParameter).toBe(0)
    })

    it('counts the argument the caret is in', () => {
      const code = "<?php User::where('a', 1,"
      const answer = phpSignature(connection.id, {code, offset: code.length})

      expect(answer.activeParameter).toBe(2)
    })

    it('reads a function’s parameters by its name', () => {
      const code = '<?php str_replace('

      expect(phpSignature(connection.id, {code, offset: code.length}).label).toContain('str_replace(')
    })

    it('answers nothing when the call is not one the read knows', () => {
      expect(phpSignature(connection.id, {code: '<?php nowhere(', offset: 14})).toBeNull()
      expect(phpSignature(connection.id, {code: '<?php User::where(', offset: 0})).toBeNull()
    })
  })

  describe('what a keystroke costs', () => {
    it('runs nothing and reaches nothing, whatever is typed', async () => {
      for (const code of ['<?php ', '<?php User::', "<?php User::where('a', 1)->", '<?php $user->', "<?php config('", '<?php str_']) {
        await complete(code)
      }

      phpSignature(connection.id, {code: '<?php User::where(', offset: 18})

      expect(ask).not.toHaveBeenCalled()
      expect(exec).not.toHaveBeenCalled()
    })

    it('reports the state of the read it answers from', () => {
      const status = intelStatus(connection)

      expect(status.state).toBe('ready')
      expect(status.counts.models).toBeGreaterThan(0)
    })
  })

  describe('the order a popup opens in, before anything is typed', () => {
    // what the read lists first is what reflection walks first, and it is not what
    // a snippet is written with: a model answers `clearBootedModels` before it
    // answers `where`, a date answers `copy` before `format`, and a cache answers
    // with the manager that hands it out rather than with `get`. These are the
    // names a popup has to open on
    const opensOn = async (code, count = 8) => firsts((await complete(code)).items, count)

    const matched = (shown, names) => names.filter(name => shown.includes(name))

    // the framework's own plumbing: booting, registering what a class can be
    // extended with, wiring a manager, and the hooks php calls on its own
    const plumbing = [
      'clearBootedModels', 'withoutTouching', 'withoutTouchingOn', 'isIgnoringTouch',
      'shouldBeStrict', 'preventLazyLoading', 'handleLazyLoadingViolationUsing',
      'resolveConnection', 'getEventDispatcher', 'refreshEventDispatcher',
      'macro', 'hasMacro', 'flushMacros', 'mixin', '__call', '__callStatic',
      'getDefaultDriver', 'setDefaultDriver', 'store', 'driver', 'memo', 'repository',
      'calculateDynamicConnectionName', 'connectUsing', 'purge',
    ]

    it('opens a model on the calls a model is written with', async () => {
      const shown = await opensOn('<?php User::')

      expect(matched(shown, ['where', 'find', 'first', 'create', 'all', 'with', 'query', 'count']).length).toBeGreaterThanOrEqual(6)
    })

    it('opens a builder on the chain it continues', async () => {
      const shown = await opensOn("<?php User::where('a', 1)->")

      expect(matched(shown, ['get', 'first', 'where', 'orderBy', 'paginate', 'count', 'pluck']).length).toBeGreaterThanOrEqual(5)
    })

    it('opens a facade on the object behind it, not on the manager', async () => {
      const cache = await opensOn('<?php Cache::')
      const database = await opensOn('<?php DB::')

      expect(matched(cache, ['get', 'put', 'remember', 'forget', 'has']).length).toBeGreaterThanOrEqual(4)
      expect(matched(database, ['table', 'select', 'transaction', 'statement']).length).toBeGreaterThanOrEqual(3)
      // `Cache::store` and `DB::connection` are how the manager is asked for one;
      // they are not what the manager is then asked to do
      expect(cache).not.toContain('memo')
      expect(cache).not.toContain('repository')
    })

    it('opens a date on the calls a date is written with', async () => {
      const shown = await opensOn('<?php now()->')

      expect(matched(shown, ['format', 'addDays', 'subDays', 'diffForHumans', 'startOfDay']).length).toBeGreaterThanOrEqual(3)
    })

    it('opens a collection on the calls a collection is written with', async () => {
      const shown = await opensOn('<?php collect([])->')

      expect(matched(shown, ['map', 'filter', 'each', 'pluck', 'first', 'sum']).length).toBeGreaterThanOrEqual(4)
    })

    it('keeps a value’s columns ahead of everything else', async () => {
      const shown = await opensOn('<?php $user = User::first();\n$user->', 3)

      expect(shown).toEqual(['id', 'name', 'email'])
    })

    // a date answers 281 members and the popup holds 200 of them: what has been
    // typed has to narrow the whole list, or a name three hundred entries into a
    // class could never be reached — the cap would have cut it before the filter
    it('reaches a member the cap left out by typing it', async () => {
      const bare = await opensOn('<?php now()->', 400)
      const typed = labels((await complete('<?php now()->addWe')).items)

      expect(bare).toHaveLength(200)
      expect(bare).not.toContain('addWeeks')
      expect(typed).toContain('addWeeks')
    })

    it('never opens on the framework’s plumbing', async () => {
      for (const code of [
        '<?php User::',
        "<?php User::where('a', 1)->",
        '<?php Cache::',
        '<?php DB::',
        '<?php now()->',
        '<?php collect([])->',
      ]) {
        const shown = await opensOn(code, 20)

        expect({code, plumbing: shown.filter(name => plumbing.includes(name))}).toEqual({code, plumbing: []})
      }
    })

    // what a class's own members are ranked by is the class itself: a scope or a
    // method the project wrote is what the person writing it is working on
    it('puts a project class’s own members before the framework’s', () => {
      const members = [
        {kind: 'method', name: 'clearBootedModels', declaring: 'Illuminate\\Database\\Eloquent\\Model'},
        {kind: 'method', name: 'forThisWeek', declaring: 'App\\Support\\Report'},
        {kind: 'method', name: 'get', declaring: 'Illuminate\\Support\\Collection'},
      ]
      const ranks = memberRanks(members, {intel: null, owner: 'App\\Support\\Report', static: true})

      expect(ranks.get(members[1]) < ranks.get(members[2])).toBe(true)
      expect(ranks.get(members[2]) < ranks.get(members[0])).toBe(true)
    })
  })
})

/**
 * A connection whose project has never been read, and the read it will give.
 *
 * The first name typed into a window that was just opened is asked before the read
 * of the project has answered, so a read that takes its time is what the first ask
 * is tested with: a project the app has never seen, on a machine that answers after
 * `delay` milliseconds.
 */
const unread = (id, delay) => {
  const root = project()
  const fresh = {id, name: id, type: 'local', path: root}

  setEditorConnection(fresh.id, fresh)
  ask.mockImplementation(() => new Promise(resolve => {
    const timer = setTimeout(() => resolve(JSON.stringify(require('./__fixtures__/intel.json'))), delay)

    // a read the test has stopped waiting on is not a reason for jest to wait too
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  }))

  return fresh
}

// the completion asked on a connection of its own
const completeOn = (target, code) => phpCompletions(target.id, {code, offset: code.length})

describe('the first ask of a window', () => {
  beforeEach(() => {
    // the reads are counted per keystroke, not across the suite
    ask.mockClear()
  })

  afterEach(() => {
    ask.mockImplementation(async () => JSON.stringify(require('./__fixtures__/intel.json')))
  })

  it('waits for the read that is already going, rather than answering an empty popup', async () => {
    const fresh = unread('first-ask-waits', 150)
    const started = Date.now()
    const answer = await completeOn(fresh, '<?php User::')

    expect(Date.now() - started).toBeGreaterThanOrEqual(140)
    expect(labels(answer.items)).toEqual(expect.arrayContaining(['where', 'first', 'find', 'create']))
    expect(answer.incomplete).toBeUndefined()
    // the read the window opened is the read the keystroke waited on: no second one
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('answers what it holds, marked incomplete, when the read outlasts the wait', async () => {
    const fresh = unread('first-ask-late', 2400)
    const started = Date.now()
    const answer = await completeOn(fresh, '<?php User::')

    // a keystroke is not a pause: the wait ends, and the list says it is short
    expect(Date.now() - started).toBeLessThan(2200)
    expect(answer).toEqual({items: [], incomplete: true})
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('shares the one read between the keystrokes that ask during it', async () => {
    const fresh = unread('first-ask-shared', 120)
    const [statics, facades] = await Promise.all([
      completeOn(fresh, '<?php User::'),
      completeOn(fresh, '<?php Cache::'),
    ])

    expect(ask).toHaveBeenCalledTimes(1)
    expect(labels(statics.items)).toContain('where')
    expect(labels(facades.items)).not.toHaveLength(0)
    expect(statics.incomplete).toBeUndefined()
    expect(facades.incomplete).toBeUndefined()
  })

  it('answers the class members it holds, marked incomplete, when that read outlasts the wait', async () => {
    const fresh = unread('first-ask-classes', 1)
    const code = '<?php \\App\\Pending::'

    await refreshIntel(fresh)

    // the project is read, and the class is not in it: the read of that class is
    // what the popup waits on, and a class whose read never answers is a list with
    // nothing in it that says so
    ask.mockImplementation(() => new Promise(() => {}))

    const started = Date.now()
    const answer = await completeOn(fresh, code)

    expect(Date.now() - started).toBeLessThan(2200)
    expect(answer).toEqual({items: [], incomplete: true})
  })

  it('answers a project class after a :: by reading the class the index names', async () => {
    const root = project()
    const fresh = {id: 'first-ask-index', name: 'Index', type: 'local', path: root}

    setEditorConnection(fresh.id, fresh)
    fs.writeFileSync(
      path.join(root, 'app', 'Support', 'Price.php'),
      '<?php\n\nnamespace App\\Support;\n\nclass Price\n{\n    public static function of(float $amount): self\n    {\n    }\n}\n',
    )

    ask
      .mockResolvedValueOnce(JSON.stringify(require('./__fixtures__/intel.json')))
      .mockResolvedValueOnce(JSON.stringify({
        class: 'App\\Support\\Price',
        exists: true,
        kind: 'class',
        methods: [{name: 'of', static: true, params: ['float $amount'], returns: 'self', declaring: 'App\\Support\\Price'}],
        properties: [],
        constants: [],
      }))

    // the read of the project does not carry the project's own classes, so the name
    // has to come from the class index and the members from a read of that class
    await refreshIntel(fresh)

    expect(labels((await completeOn(fresh, '<?php Price::')).items)).toEqual(['of'])
    expect(ask).toHaveBeenCalledTimes(2)
  })
})
