const fs = require('fs')
const os = require('os')
const path = require('path')

// a project over ssh is read by a command of its own, and a test has no machine
// to reach: what another machine would answer is what this answers with
jest.mock('../remote', () => ({
  exec: jest.fn(),
  quoted: jest.requireActual('../remote').quoted,
}))

const {clearClassIndex} = require('tinkr-core')

const {exec} = require('../remote')
const {
  indexFor,
  readyIndex,
  prefetchIndex,
  refreshIndex,
  filesFor,
  attachmentsFor,
  clearRemoteIndexes,
} = require('../services/project')
const {maxFile} = require('../services/files')
const {setBackgroundPtyProcess} = require('../processes')

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

// what the php of the index prints: the composer files of the project, the paths
// of its own directories, and the paths as the project spells them, which is the
// one spelling both machines share
const described = (declared = {}) => JSON.stringify({
  classmap: [],
  psr4: {'App\\': ['app']},
  files: ['app/Models/Order.php'],
  ...declared,
})

// what php prints for a file: its content, base64 encoded, which is what keeps
// one answer to one line of a shell's
const encoded = content => Buffer.from(content, 'utf8').toString('base64')

/**
 * The php a command carries, as it was written: `exec` runs it as one word of
 * the shell's, so the quotes of the php itself come back escaped.
 *
 * @param {String} command
 * @return {String}
 */
const phpOf = command => {
  const [, php = ''] = /^php -r '(.*)'$/s.exec(command) || []

  return php.replace(/'\\''/g, "'")
}

/**
 * A machine that answers the questions the project service asks it: what the
 * composer files of its project declare, and what a file of it holds.
 *
 * @param {Object} [answers]
 * @param {String|null} [answers.project] what the php of the index prints, or
 * null for a machine that does not answer at all
 * @param {Function} [answers.read] what a read of a file answers with, given the
 * php that asks for it, or null for a file it cannot read
 */
const machine = ({project = 'null', read = () => null} = {}) =>
  exec.mockImplementation(async (connection, command) => {
    const php = phpOf(command)

    if (!php.includes('file_get_contents')) {
      // a machine that is not there, or one without php, says nothing at all,
      // which is not the same as a project with nothing in it
      return project === null
        ? {stdout: '', stderr: 'Connection to app closed.', code: 255}
        : {stdout: project, stderr: '', code: 0}
    }

    const content = read(php)

    return content === null
      ? {stdout: '', stderr: 'No such file', code: 1}
      : {stdout: content, stderr: '', code: 0}
  })

/**
 * A session that records what it is asked: a project is asked of the machine
 * with a command of its own, so this is what says the session is asked nothing.
 */
const session = () => ({
  asked: [],
  jsonResult(code) {
    this.asked.push(code)

    return Promise.resolve('null')
  },
})

// the path a read of a file asked for, as phpString wrote it into the question
const readPath = code => /file_get_contents\('((?:[^'\\]|\\.)*)'/.exec(code)[1]

describe('the project of a connection', () => {
  afterEach(() => {
    clearClassIndex()
    clearRemoteIndexes()
    exec.mockReset()
    setBackgroundPtyProcess('remote', null)
  })

  test('reads the project of a connection on this machine from this machine', async () => {
    const connection = {id: 'local', path: orders(), is_over_ssh: false}
    const found = await indexFor(connection)

    expect(Array.from(found.index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(found.files.map(one => one.file)).toEqual([
      path.join(connection.path, 'app/Models/Order.php'),
      path.join(connection.path, 'app/Models/OrderLine.php'),
    ])
    // a local project is a directory of this machine, read here: no machine is
    // asked anything for it
    expect(exec).not.toHaveBeenCalled()
  })

  test('answers the popup of a local project out of the read of it', async () => {
    const connection = {id: 'local', path: orders(), is_over_ssh: false}

    expect(Array.from(readyIndex(connection).index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(exec).not.toHaveBeenCalled()
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

  test('reads the project of a connection over ssh with a command of its own', async () => {
    const connection = {id: 'remote', path: '/var/www/app', is_over_ssh: true}
    const pty = session()

    setBackgroundPtyProcess('remote', pty)
    machine({project: described()})

    const found = await indexFor(connection)

    expect(Array.from(found.index.get('order'))).toEqual(['App\\Models\\Order'])

    // one command, run on the machine the connection reaches, and none in the
    // session the person works in: the walk never occupies their prompt
    expect(exec).toHaveBeenCalledTimes(1)
    expect(pty.asked).toEqual([])

    const [asked, command] = exec.mock.calls[0]

    expect(asked).toBe(connection)
    expect(command).toContain("php -r '")
    expect(command).toContain('autoload_classmap')
    expect(command).toContain('autoload_psr4')
    expect(command).toContain('RecursiveDirectoryIterator')
    // one line of php, which is one line of the command: what a machine is asked
    // is one question in a process list, in a log and in a terminal's history
    expect(command).not.toContain('\n')
    // the project is the directory the command runs in, which is what exec
    // gives it, and the one thing both machines mean the same by
    expect(phpOf(command)).toContain('getcwd()')
  })

  test('asks the machine once, whatever asks for the project', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    machine({project: described()})

    // the read a session starts, before anything is typed
    const prefetched = prefetchIndex(connection)

    // nothing has answered yet, and both of these are handed the read that is
    // already happening instead of starting one of their own
    const [forAPrompt, again] = await Promise.all([indexFor(connection), indexFor(connection)])

    expect(exec).toHaveBeenCalledTimes(1)
    expect(Array.from(forAPrompt.index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(Array.from(again.index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(Array.from((await prefetched).index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(exec).toHaveBeenCalledTimes(1)
  })

  test('answers the popup out of what has been read, and reads nothing for it', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    // the popup's question arrives with a keystroke, and a keystroke neither
    // waits for another machine nor sets it going
    expect(readyIndex(connection)).toBe(null)
    expect(exec).not.toHaveBeenCalled()

    machine({project: described()})
    await prefetchIndex(connection)

    expect(Array.from(readyIndex(connection).index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(exec).toHaveBeenCalledTimes(1)
  })

  test('prefetches a project that has not been read, and reads it no more than once', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    machine({project: described()})
    await prefetchIndex(connection)

    expect(Array.from(readyIndex(connection).index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(exec).toHaveBeenCalledTimes(1)

    // a session comes up again — a connection opened, or the session a run left
    // behind — and what has been read is what it is answered with: no second
    // walk of another machine's filesystem
    expect(prefetchIndex(connection)).toBe(undefined)
    expect(prefetchIndex(connection)).toBe(undefined)
    expect(exec).toHaveBeenCalledTimes(1)

    // and the popup that keystrokes bring is answered out of the same read
    expect(Array.from(readyIndex(connection).index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(exec).toHaveBeenCalledTimes(1)
  })

  test('reads the project again where a run has finished', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    machine({project: described()})
    await prefetchIndex(connection)

    // the run wrote a class, and what came back is what the project declares now
    machine({project: described({classmap: ['App\\Models\\Stage']})})
    const refreshing = refreshIndex(connection)

    // a read is a read: what the project answered before answers until it
    // answers again, so nothing waiting on it is made to wait for a refresh
    expect(Array.from(readyIndex(connection).index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(exec).toHaveBeenCalledTimes(2)

    await refreshing

    expect(Array.from(readyIndex(connection).index.get('stage'))).toEqual(['App\\Models\\Stage'])
    expect(exec).toHaveBeenCalledTimes(2)
  })

  test('prefetches nothing for a project of this machine', async () => {
    const connection = {id: 'local', path: orders(), is_over_ssh: false}

    expect(prefetchIndex(connection)).toBe(undefined)
    expect(refreshIndex(connection)).toBe(undefined)
    expect(exec).not.toHaveBeenCalled()
  })

  test('offers nothing at all when the machine cannot describe the project', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    // the machine did not answer: no link, no php, or an answer too large to keep
    machine({project: null})
    expect(await indexFor(connection)).toBe(null)
    expect(await filesFor(connection, 'Ord')).toEqual([])
    expect(await attachmentsFor(connection, '@Order')).toEqual([])

    // it answered with something that is not its answer
    machine({project: 'not json'})
    expect(await indexFor(connection)).toBe(null)

    // it answered that the project declares nothing, which is an answer: an empty
    // index, and not one worth reading again
    machine({project: 'null'})
    expect((await indexFor(connection)).index.size).toBe(0)
    expect(await filesFor(connection, 'Ord')).toEqual([])

    // a silence is asked again, and an answer is kept
    expect(exec).toHaveBeenCalledTimes(5)
  })

  test('asks nothing for a connection the app is not showing', async () => {
    expect(await indexFor(null)).toBe(null)
    expect(await indexFor(undefined)).toBe(null)
    expect(readyIndex(null)).toBe(null)
    expect(prefetchIndex(null)).toBe(undefined)
    expect(await filesFor(null, 'Order')).toEqual([])
    expect(await attachmentsFor(null, '@Order')).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })

  test('reads an answer from another machine with the naming rule, paths and all', async () => {
    machine({
      project: described({
        classmap: ['App\\Models\\Order', 'Acme\\Gadget'],
        psr4: {'App\\': ['app'], 'Acme\\': ['vendor/acme/src']},
        files: ['app/Models/Order.php', 'app/Models/JustCreated.php', 'vendor/acme/src/Gadget.php'],
      }),
    })

    const found = await indexFor({id: 'remote', path: '/var/www/app', is_over_ssh: true})

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

  test('offers the files of a project over ssh as that project spells them', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    machine({project: described({files: ['app/Models/Order.php', 'app/Support/Helper.php']})})

    expect(await filesFor(connection, 'Order')).toEqual([
      {name: 'Order', qualified: 'App\\Models\\Order', path: 'app/Models/Order.php'},
    ])
  })

  test('carries the content of a file read through a command of its own', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    machine({
      project: described({files: ['app/Models/Order.php', 'app/Models/OrderLine.php']}),
      read: php => encoded(`<?php // the ${readPath(php)}\n`),
    })

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

    // the project once, then one command per file, and a read knows the path it
    // is for: nothing is read that the prompt did not name
    expect(exec).toHaveBeenCalledTimes(3)

    const read = exec.mock.calls[1][1]

    expect(read).toContain(
      `file_get_contents('\\''app/Models/Order.php'\\'',false,null,0,${maxFile + 1})`,
    )
    expect(read).toContain('base64_encode')
  })

  test('leaves out a file the machine cannot read', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    // the file went away between the index and the read, and a read of it exits
    // with something other than zero
    machine({project: described({files: ['app/Models/Order.php']})})

    expect(await attachmentsFor(connection, '@Order')).toEqual([])
  })

  test('reads no more of a file than a prompt carries', async () => {
    const connection = {id: 'remote', is_over_ssh: true}
    const whole = 'x'.repeat(maxFile * 2)

    machine({
      project: described({files: ['app/Models/Order.php']}),
      // php answers with one byte more than a prompt would carry, which is what
      // says the file was longer
      read: () => encoded(whole.slice(0, maxFile + 1)),
    })

    const [attachment] = await attachmentsFor(connection, '@Order')

    expect(attachment.code).toBe(`${whole.slice(0, maxFile)}\n// … the rest of this file was not sent`)
  })

  test('offers a name the machine names two classes for to nobody', async () => {
    const connection = {id: 'remote', is_over_ssh: true}

    machine({
      project: described({
        classmap: ['App\\Models\\Order', 'Other\\Order'],
      }),
    })

    const found = await indexFor(connection)

    // two classes carry the name, and the suggestion of one of them would be a
    // guess: the popup is what leaves it alone (see completion)
    expect(found.index.get('order').size).toBe(2)
  })
})
