const fs = require('fs')
const os = require('os')
const path = require('path')

// a project is read from the connection's own machine, and a test has no session
// to boot for the one over ssh
jest.mock('../createBackgroundPty', () => ({ensureBackgroundPty: () => {}}))

const {clearClassIndex} = require('tinkr-core')

const {indexFor, filesFor, attachmentsFor, clearRemoteIndexes} = require('../services/project')
const {maxFile} = require('../services/files')
const {
  getBackgroundPtyProcess,
  setBackgroundPtyProcess,
  setEditorConnection,
} = require('../processes')

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

/**
 * A project of this machine, the way composer writes one: a psr-4 map, a
 * classmap, and the files the classes live in.
 */
const project = classes => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-project-'))

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

const orders = () => project([
  ['App\\Models\\Order', 'app/Models/Order.php'],
  ['App\\Models\\OrderLine', 'app/Models/OrderLine.php'],
])

// what the php of the index answers with, as the json of the form's value: the
// paths are the project's own, which is the spelling both machines share
const described = (declared = {}) => JSON.stringify({
  classmap: [],
  psr4: {'App\\': ['app']},
  files: ['app/Models/Order.php'],
  ...declared,
})

// what php answers for a file: its content, base64 encoded
const encoded = content => JSON.stringify(Buffer.from(content, 'utf8').toString('base64'))

/**
 * A session that answers the two questions the project service puts to it: what
 * the composer files of its machine declare, and what a file holds.
 *
 * @param {Object} [answers]
 * @param {String} [answers.project] the json of the index question
 * @param {Function} [answers.read] what a read of a file answers, given the form
 * value that asks for it
 */
const session = ({reported = 'null', read = () => 'null'} = {}) => ({
  asked: [],
  jsonResult(code) {
    this.asked.push(code)

    if (code.includes('autoload_classmap')) {
      return Promise.resolve(reported)
    }

    return Promise.resolve(code.includes('file_get_contents') ? read(code) : 'null')
  },
})

// the path a read of a file asked for, as phpString wrote it into the question
const readPath = code => /file_get_contents\('((?:[^'\\]|\\.)*)'/.exec(code)[1]

describe('the project of a connection', () => {
  afterEach(() => {
    clearClassIndex()
    clearRemoteIndexes()
    setBackgroundPtyProcess('local', null)
    setBackgroundPtyProcess('remote', null)
    setEditorConnection('remote', null)
  })

  test('reads the project of a connection on this machine from this machine', async () => {
    const connection = {id: 'local', path: orders(), is_over_ssh: false}
    const found = await indexFor(connection)

    expect(Array.from(found.index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(found.files.map(one => one.file)).toEqual([
      path.join(connection.path, 'app/Models/Order.php'),
      path.join(connection.path, 'app/Models/OrderLine.php'),
    ])
    // there is no session in this test at all, which is the point: a local
    // project is read here
    expect(getBackgroundPtyProcess('local')).toBe(undefined)
  })

  test('offers the files of a local project as the project spells them', async () => {
    const connection = {id: 'local', path: orders(), is_over_ssh: false}

    expect(await filesFor(connection, 'Order')).toEqual([
      {name: 'Order', qualified: 'App\\Models\\Order', path: 'app/Models/Order.php'},
      {name: 'OrderLine', qualified: 'App\\Models\\OrderLine', path: 'app/Models/OrderLine.php'},
    ])
  })

  test('carries the content of a file a local prompt names', async () => {
    const connection = {id: 'local', path: orders(), is_over_ssh: false}

    expect(await attachmentsFor(connection, 'the order @App\\Models\\Order line')).toEqual([
      {
        name: 'Order',
        qualified: 'App\\Models\\Order',
        path: 'app/Models/Order.php',
        code: '<?php // App\\Models\\Order\n',
      },
    ])
  })

  test('reads the project of a connection over ssh from its own session', async () => {
    const connection = {id: 'remote', path: '/var/www/app', is_over_ssh: true}

    setEditorConnection('remote', connection)

    const pty = session({reported: described()})

    setBackgroundPtyProcess('remote', pty)

    const found = await indexFor(connection)

    expect(Array.from(found.index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(pty.asked).toHaveLength(1)
  })

  test('asks the session for the composer files of the project it runs in', async () => {
    setEditorConnection('remote', {id: 'remote', path: '/var/www/app', is_over_ssh: true})

    const pty = session({reported: described()})

    setBackgroundPtyProcess('remote', pty)
    await indexFor({id: 'remote', is_over_ssh: true})

    const question = pty.asked[0]

    expect(question).toContain('autoload_classmap')
    expect(question).toContain('autoload_psr4')
    expect(question).toContain('RecursiveDirectoryIterator')
    // one line, because it is written into the session the way any input is
    expect(question).not.toContain('\n')
    // the project of the session, which is where the connection put it
    expect(question).toContain('getcwd()')
  })

  test('asks the project once, and again when a run replaced the session', async () => {
    setEditorConnection('remote', {id: 'remote', path: '/var/www/app', is_over_ssh: true})

    const first = session({reported: described()})

    setBackgroundPtyProcess('remote', first)
    await indexFor({id: 'remote', is_over_ssh: true})
    await indexFor({id: 'remote', is_over_ssh: true})

    expect(first.asked).toHaveLength(1)

    const second = session({reported: described({classmap: ['App\\Models\\Stage']})})

    setBackgroundPtyProcess('remote', second)

    expect(Array.from((await indexFor({id: 'remote', is_over_ssh: true})).index.get('stage')))
      .toEqual(['App\\Models\\Stage'])
    expect(second.asked).toHaveLength(1)
  })

  test('reads an answer from another machine with the naming rule, paths and all', async () => {
    setEditorConnection('remote', {id: 'remote', path: '/var/www/app', is_over_ssh: true})

    const pty = session({
      reported: described({
        classmap: ['App\\Models\\Order', 'Acme\\Gadget'],
        psr4: {'App\\': ['app'], 'Acme\\': ['vendor/acme/src']},
        files: ['app/Models/Order.php', 'app/Models/JustCreated.php', 'vendor/acme/src/Gadget.php'],
      }),
    })

    setBackgroundPtyProcess('remote', pty)

    const found = await indexFor({id: 'remote', is_over_ssh: true})

    // a class that came after the classmap, named by the file the walk listed
    expect(Array.from(found.index.get('justcreated'))).toEqual(['App\\Models\\JustCreated'])
    // a package's class is a name to suggest, and none of it is a file anyone is
    // working on; the project's own namespaces come first
    expect(Array.from(found.index.get('gadget'))).toEqual(['Acme\\Gadget'])
    expect(found.own).toEqual(['app\\'])
    expect(found.files.map(one => one.file)).toEqual([
      'app/Models/JustCreated.php',
      'app/Models/Order.php',
    ])
  })

  test('asks nothing for a connection the app is not showing', async () => {
    expect(await indexFor(null)).toBe(null)
    expect(await indexFor(undefined)).toBe(null)
    expect(await filesFor(null, 'Order')).toEqual([])
    expect(await attachmentsFor(null, '@Order')).toEqual([])
  })

  test('offers nothing at all when a session cannot describe its project', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    setEditorConnection('remote', connection)

    // the session went away mid-question
    setBackgroundPtyProcess('remote', {jsonResult: () => Promise.reject(new Error('Timeout, try to reconnect!'))})
    expect(await filesFor(connection, 'Ord')).toEqual([])
    expect(await attachmentsFor(connection, '@Order')).toEqual([])

    // it answered with something that is not its answer
    setBackgroundPtyProcess('remote', {jsonResult: () => Promise.resolve('not json')})
    expect(await indexFor(connection)).toBe(null)

    // it answered with nothing, which is a project with no composer directory
    setBackgroundPtyProcess('remote', {jsonResult: () => Promise.resolve('null')})
    expect(await indexFor(connection)).toBe(null)
  })

  test('offers the files of a project over ssh as that project spells them', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    setEditorConnection('remote', connection)

    setBackgroundPtyProcess('remote', session({
      reported: described({files: ['app/Models/Order.php', 'app/Support/Helper.php']}),
    }))

    expect(await filesFor(connection, 'Order')).toEqual([
      {name: 'Order', qualified: 'App\\Models\\Order', path: 'app/Models/Order.php'},
    ])
  })

  test('carries the content of a file read through the session', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    setEditorConnection('remote', connection)

    const pty = session({
      reported: described({files: ['app/Models/Order.php', 'app/Models/OrderLine.php']}),
      read: code => encoded(`<?php // the ${readPath(code)}\n`),
    })

    setBackgroundPtyProcess('remote', pty)

    const attachments = await attachmentsFor(connection, '@Order and @App\\Models\\OrderLine')

    expect(attachments).toEqual([
      {
        name: 'Order',
        qualified: 'App\\Models\\Order',
        path: 'app/Models/Order.php',
        code: '<?php // the app/Models/Order.php\n',
      },
      {
        name: 'OrderLine',
        qualified: 'App\\Models\\OrderLine',
        path: 'app/Models/OrderLine.php',
        code: '<?php // the app/Models/OrderLine.php\n',
      },
    ])

    // the project once, then one read per file, and a read knows the path it is
    // for: nothing is read that the prompt did not name
    expect(pty.asked).toHaveLength(3)
    expect(pty.asked[1]).toContain(`file_get_contents('app/Models/Order.php',false,null,0,${maxFile + 1})`)
  })

  test('leaves out a file the session cannot read', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    setEditorConnection('remote', connection)

    setBackgroundPtyProcess('remote', session({
      reported: described({files: ['app/Models/Order.php']}),
      // the file went away between the index and the read
      read: () => 'null',
    }))

    expect(await attachmentsFor(connection, '@Order')).toEqual([])
  })

  test('reads no more of a file than a prompt carries', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    setEditorConnection('remote', connection)

    const whole = 'x'.repeat(maxFile * 2)

    setBackgroundPtyProcess('remote', session({
      reported: described({files: ['app/Models/Order.php']}),
      // php answers with one byte more than a prompt would carry, which is what
      // says the file was longer
      read: () => encoded(whole.slice(0, maxFile + 1)),
    }))

    const [attachment] = await attachmentsFor(connection, '@Order')

    expect(attachment.code).toBe(`${whole.slice(0, maxFile)}\n// … the rest of this file was not sent`)
  })

  test('offers a name the session names two classes for to nobody', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    setEditorConnection('remote', connection)

    setBackgroundPtyProcess('remote', session({
      reported: described({
        classmap: ['App\\Models\\Order', 'Other\\Order'],
      }),
    }))

    const found = await indexFor(connection)

    // two classes carry the name, and the suggestion of one of them would be a
    // guess: the popup is what leaves it alone (see completion)
    expect(found.index.get('order').size).toBe(2)
  })
})
