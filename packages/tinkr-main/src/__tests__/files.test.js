jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp'}}))
jest.mock('electron-store', () => class Store {
  get(key, fallback) { return fallback }
})

const fs = require('fs')
const os = require('os')
const path = require('path')

const {clearClassIndex} = require('tinkr-core')

const {filesFor, mentions, attachmentsFor, maxFile} = require('../services/files')

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

/**
 * A project shaped like the ones composer writes: a psr-4 map that points the
 * project's own namespace at a directory, and the files under it.
 */
const project = files => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-files-'))

  write(path.join(root, 'vendor/composer/autoload_psr4.php'), `<?php

$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);

return array(
    'App\\\\' => array($baseDir . '/app'),
);
`)

  for (const [name, code] of Object.entries(files)) {
    write(path.join(root, 'app', `${name}.php`), code)
  }

  return root
}

describe('the files a prompt can name', () => {
  afterEach(() => {
    clearClassIndex()
  })

  test('are the project\'s own, with the path the project writes', () => {
    const root = project({User: '<?php class User {}'})

    expect(filesFor(root, 'Us')).toEqual([
      {name: 'User', qualified: 'App\\User', path: path.join('app', 'User.php')},
    ])
  })

  test('are none at all when there is no project to read', () => {
    expect(filesFor(null, 'Us')).toEqual([])
    expect(attachmentsFor(null, 'read @User')).toEqual([])
  })
})

describe('the names a prompt mentions', () => {
  test('are the `@` words, once each', () => {
    expect(mentions('what does @User do, and @App\\Models\\Order?')).toEqual(['User', 'App\\Models\\Order'])
    expect(mentions('@User and @User again')).toEqual(['User'])
  })

  test('are not the `@` of an email address', () => {
    expect(mentions('write to ada@example.com about @User')).toEqual(['User'])
  })

  test('are none in a prompt without one', () => {
    expect(mentions('count the users')).toEqual([])
    expect(mentions('')).toEqual([])
  })
})

describe('the files a request carries', () => {
  afterEach(() => {
    clearClassIndex()
  })

  test('are the ones the prompt names, read', () => {
    const root = project({User: '<?php\n\nclass User\n{\n    public function name()\n    {\n        return \'ada\';\n    }\n}\n'})

    expect(attachmentsFor(root, 'explain @User')).toEqual([{
      name: 'User',
      qualified: 'App\\User',
      path: path.join('app', 'User.php'),
      code: '<?php\n\nclass User\n{\n    public function name()\n    {\n        return \'ada\';\n    }\n}\n',
    }])
  })

  test('leave out a name the project does not declare', () => {
    const root = project({User: '<?php class User {}'})

    expect(attachmentsFor(root, 'explain @Whatever')).toEqual([])
    expect(attachmentsFor(root, 'explain @Whatever and @User')).toHaveLength(1)
  })

  test('are cut when a file is more than a request should carry', () => {
    const root = project({Huge: `<?php\n${'// a line of it\n'.repeat(4000)}`})

    const [file] = attachmentsFor(root, '@Huge')

    expect(file.code).toHaveLength(maxFile + '\n// … the rest of this file was not sent'.length)
    expect(file.code).toMatch(/\/\/ … the rest of this file was not sent$/)
  })

  test('are at most the few a prompt is worth', () => {
    const files = {}
    const names = Array.from({length: 6}, (unused, at) => `Class${at}`)

    for (const name of names) {
      files[name] = `<?php class ${name} {}`
    }

    const root = project(files)

    expect(attachmentsFor(root, names.map(name => `@${name}`).join(' '))).toHaveLength(3)
  })
})
