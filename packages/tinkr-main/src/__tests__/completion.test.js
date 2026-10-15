const fs = require('fs')
const os = require('os')
const path = require('path')

// a completion boots the connection's session the way the snippet form does, and
// a test has no session to boot
jest.mock('../createBackgroundPty', () => ({ensureBackgroundPty: () => {}}))

const {classIndex, clearClassIndex} = require('tinkr-core')

const {phpCompletions, reflectionCode} = require('../completion')
const {getBackgroundPtyProcess, setBackgroundPtyProcess, setEditorConnection} = require('../processes')

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

/**
 * A project with the classes a snippet can name, the way composer writes one: a
 * psr-4 map, a classmap, and the files the classes live in.
 */
const project = classes => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-completion-'))

  write(path.join(root, 'vendor/composer/autoload_psr4.php'), `<?php

$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);

return array(
    'App\\\\' => array($baseDir . '/app'),
);
`)

  write(path.join(root, 'vendor/composer/autoload_classmap.php'), `<?php

$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);

return array(
${classes.map(([name, file]) => `    '${name.replace(/\\/g, '\\\\')}' => $baseDir . '/${file}',`).join('\n')}
);
`)

  for (const [name, file] of classes) {
    write(path.join(root, file), `<?php // ${name}\n`)
  }

  return root
}

const teatro = () => project([
  ['App\\Models\\Teatro', 'app/Models/Teatro.php'],
  ['App\\Models\\Teatrillo', 'app/Models/Teatrillo.php'],
  ['App\\Support\\Helper', 'app/Support/Helper.php'],
])

/**
 * A session that answers the way the reflection does: it writes what it was asked
 * for to the file the question names, and prints nothing but a number, so that a
 * popup never hands psysh a screenful to page.
 */
const session = answer => ({
  asked: [],
  jsonResult(code) {
    this.asked.push(code)

    const file = /file_put_contents\('((?:[^'\\]|\\.)*)'/.exec(code)

    fs.writeFileSync(file[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'), answer)

    return Promise.resolve('1')
  },
})

const methods = list => JSON.stringify({class: 'App\\Models\\Teatro', methods: list})

const where = {
  name: 'where',
  return: 'Illuminate\\Database\\Eloquent\\Builder',
  parameters: [
    {name: 'column', type: 'mixed', optional: false, variadic: false},
    {name: 'operator', type: 'mixed', optional: true, variadic: false},
  ],
}

// what a method item inserts: a snippet whose caret starts in its first
// parameter (written in two pieces so it is not read as a template)
const whereCall = 'where($' + '{1:column})'

// the class the tests ask about, as phpString writes it into the session
const reflected = 'App\\\\Models\\\\Teatro'

describe('the completion of a php snippet', () => {
  const connection = {id: 'completion', path: null, is_over_ssh: false}
  // the cursor is at the end of what the editor holds in every test here
  const at = code => ({code, offset: code.length})

  beforeEach(() => {
    setEditorConnection(connection.id, connection)
  })

  afterEach(() => {
    clearClassIndex()
    setBackgroundPtyProcess(connection.id, null)
  })

  test('names the classes a typed prefix is the beginning of', async () => {
    connection.path = teatro()

    const {items} = await phpCompletions(connection.id, at('Tea'))

    expect(items).toEqual([
      {
        type: 'class',
        label: 'Teatrillo',
        detail: 'App\\Models\\Teatrillo',
        filter: 'Teatrillo',
        insert: 'Teatrillo',
      },
      {type: 'class', label: 'Teatro', detail: 'App\\Models\\Teatro', filter: 'Teatro', insert: 'Teatro'},
    ])
  })

  test('names a class the snippet is spelling its namespace out for', async () => {
    connection.path = teatro()

    const {items} = await phpCompletions(connection.id, at('App\\Models\\Tea'))

    expect(items.map(item => item.detail))
      .toEqual(['App\\Models\\Teatrillo', 'App\\Models\\Teatro'])
  })

  test('shows nothing for the first colon of a `::`, and nothing for a space', async () => {
    connection.path = teatro()

    expect((await phpCompletions(connection.id, {
      ...at('Teatro:'),
      triggerCharacter: ':',
    })).items).toEqual([])
    expect((await phpCompletions(connection.id, at('$x = '))).items).toEqual([])
  })

  test('shows nothing after a `->`, whose variable nothing knows', async () => {
    connection.path = teatro()
    setBackgroundPtyProcess(connection.id, session(methods([])))

    expect((await phpCompletions(connection.id, at('$teatro->'))).items).toEqual([])
    expect((await phpCompletions(connection.id, at('Teatro::query()->'))).items).toEqual([])
  })

  test('asks the session to reflect the class a `::` was written after', async () => {
    connection.path = teatro()

    const pty = session(methods([where, {name: 'query', return: null, parameters: []}]))

    setBackgroundPtyProcess(connection.id, pty)

    const {items} = await phpCompletions(connection.id, at('Teatro::'))

    expect(pty.asked).toHaveLength(1)
    expect(pty.asked[0]).toContain('IS_PUBLIC')
    expect(pty.asked[0]).toContain(`new \\ReflectionClass('${reflected}')`)
    expect(items).toEqual([
      {
        type: 'method',
        label: 'where(mixed $column, [mixed $operator])',
        detail: 'Builder',
        filter: 'where',
        insert: whereCall,
        snippet: true,
      },
      {
        type: 'method',
        label: 'query()',
        detail: '',
        filter: 'query',
        insert: 'query()',
        snippet: false,
      },
    ])
  })

  test('asks again when the snippet has a `use` of its own, and the project does not know the name', async () => {
    connection.path = project([])

    const pty = session(methods([]))

    setBackgroundPtyProcess(connection.id, pty)

    await phpCompletions(connection.id, at('use App\\Models\\Teatro;\nTeatro::'))

    expect(pty.asked).toHaveLength(1)
    expect(pty.asked[0]).toContain(`new \\ReflectionClass('${reflected}')`)
  })

  test('answers a `use` alias the way the snippet will call it', async () => {
    connection.path = project([])

    const pty = session(methods([]))

    setBackgroundPtyProcess(connection.id, pty)

    await phpCompletions(connection.id, at('use App\\Models\\Teatro as T;\nT::'))

    expect(pty.asked[0]).toContain(`new \\ReflectionClass('${reflected}')`)
  })

  test('filters the methods of a class to what has been typed of the name', async () => {
    connection.path = teatro()
    setBackgroundPtyProcess(connection.id, session(methods([where, {name: 'count', return: 'int', parameters: []}])))

    const {items} = await phpCompletions(connection.id, at('Teatro::wh'))

    expect(items.map(item => item.label)).toEqual(['where(mixed $column, [mixed $operator])'])
  })

  test('asks the session once for a class, however many keystrokes follow', async () => {
    connection.path = teatro()

    const pty = session(methods([where]))

    setBackgroundPtyProcess(connection.id, pty)

    await phpCompletions(connection.id, at('Teatro::'))
    await phpCompletions(connection.id, at('Teatro::w'))
    await phpCompletions(connection.id, at('Teatro::wh'))

    expect(pty.asked).toHaveLength(1)
  })

  test('shows nothing for a name that is not a class of the project', async () => {
    connection.path = teatro()

    const pty = session(methods([]))

    setBackgroundPtyProcess(connection.id, pty)

    expect((await phpCompletions(connection.id, at('Foo::'))).items).toEqual([])
    // nothing was asked: the name is not one the project declares, and asking
    // the session would be asking it to guess
    expect(pty.asked).toEqual([])
  })

  test('shows nothing for a name two classes carry', async () => {
    connection.path = project([
      ['App\\Models\\Teatro', 'app/Models/Teatro.php'],
      ['Other\\Teatro', 'other/Teatro.php'],
    ])

    const pty = session(methods([]))

    setBackgroundPtyProcess(connection.id, pty)

    expect((await phpCompletions(connection.id, at('Teatro::'))).items).toEqual([])
    expect(pty.asked).toEqual([])
  })

  test('reads a name of another case as the one class that carries it', async () => {
    connection.path = teatro()

    const pty = session(methods([]))

    setBackgroundPtyProcess(connection.id, pty)

    await phpCompletions(connection.id, at('teatro::'))

    expect(pty.asked[0]).toContain(`new \\ReflectionClass('${reflected}')`)
  })

  test('shows nothing when no session is up for the connection', async () => {
    connection.path = teatro()

    expect(getBackgroundPtyProcess(connection.id)).toBe(null)
    expect((await phpCompletions(connection.id, at('Teatro::'))).items).toEqual([])
  })

  test('shows nothing, rather than an error, when the session cannot load the class', async () => {
    connection.path = teatro()

    setBackgroundPtyProcess(connection.id, session(JSON.stringify({error: 'Class "App\\Models\\Teatro" not found'})))

    expect((await phpCompletions(connection.id, at('Teatro::'))).items).toEqual([])
  })

  test('shows nothing when the session goes away mid question, and asks the next one', async () => {
    connection.path = teatro()

    let asked = 0

    setBackgroundPtyProcess(connection.id, {
      jsonResult: () => {
        asked++

        return Promise.reject(new Error('The session was restarted, ask the form again.'))
      },
    })

    expect((await phpCompletions(connection.id, at('Teatro::'))).items).toEqual([])
    expect((await phpCompletions(connection.id, at('Teatro::'))).items).toEqual([])
    expect(asked).toBe(2)
  })

  test('shows nothing when the session answers with something that is not its answer', async () => {
    connection.path = teatro()

    setBackgroundPtyProcess(connection.id, session('not json'))

    expect((await phpCompletions(connection.id, at('Teatro::'))).items).toEqual([])
  })

  test('asks the session a run replaced, since the class on disk is what it is for', async () => {
    connection.path = teatro()

    const first = session(methods([where]))

    setBackgroundPtyProcess(connection.id, first)
    await phpCompletions(connection.id, at('Teatro::'))

    const second = session(methods([{name: 'count', return: 'int', parameters: []}]))

    setBackgroundPtyProcess(connection.id, second)

    const {items} = await phpCompletions(connection.id, at('Teatro::'))

    expect(first.asked).toHaveLength(1)
    expect(second.asked).toHaveLength(1)
    expect(items.map(item => item.label)).toEqual(['count()'])
  })

  test('answers nothing at all when the project is not a php project', async () => {
    connection.path = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-noproject-'))

    expect((await phpCompletions(connection.id, at('Tea'))).items).toEqual([])
  })

  test('answers nothing for a connection the app is not showing', async () => {
    expect(await phpCompletions('nobody', at('Tea'))).toEqual({items: []})
    expect(await phpCompletions(undefined, {})).toEqual({items: []})
  })

  test('answers no class names for a session over ssh, whose project is not here', async () => {
    setEditorConnection('remote', {id: 'remote', path: teatro(), is_over_ssh: true})

    expect(await phpCompletions('remote', at('Tea'))).toEqual({items: []})
  })

  test('asks for a class over ssh by the name the snippet wrote, which needs no index', async () => {
    setEditorConnection('remote', {id: 'remote', path: '/var/www/app', is_over_ssh: true})

    const pty = session(methods([]))

    setBackgroundPtyProcess('remote', pty)

    await phpCompletions('remote', at('App\\Models\\Teatro::'))

    expect(pty.asked[0]).toContain(`new \\ReflectionClass('${reflected}')`)
    expect(getBackgroundPtyProcess('remote')).toBe(pty)

    setBackgroundPtyProcess('remote', null)
  })

  test('reads the project once, for the suggestions as well as for a run', async () => {
    connection.path = teatro()

    expect(classIndex(connection.path)).toBe(classIndex(connection.path))
  })

  test('writes the reflection of a class into the session in one line, and into a file', () => {
    const code = reflectionCode('App\\Models\\Teatro', '/tmp/tinkr-reflection.json')

    expect(code).not.toContain('\n')
    expect(code).toContain('getMethods')
    expect(code).toContain("file_put_contents('/tmp/tinkr-reflection.json'")
  })

  test('leaves no file of a reflection behind', async () => {
    connection.path = teatro()

    const pty = session(methods([where]))

    setBackgroundPtyProcess(connection.id, pty)
    await phpCompletions(connection.id, at('Teatro::'))

    const written = pty.asked[0].match(/file_put_contents\('([^']+)'/)

    expect(fs.existsSync(written[1])).toBe(false)
  })
})
