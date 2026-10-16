const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  classIndex,
  indexFrom,
  matchingIn,
  matchingClasses,
  matchingFilesIn,
  importsFor,
  projectFiles,
  matchingFiles,
  clearClassIndex,
} = require('../classIndex')

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

const psr4 = prefixes => `<?php

$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);

return array(
${prefixes.map(([prefix, dir]) => `    '${prefix}' => array(${dir}),`).join('\n')}
);
`

const classmap = classes => `<?php

$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);

return array(
${classes.map(([name, file]) => `    '${name.replace(/\\/g, '\\\\')}' => $baseDir . '/${file}',`).join('\n')}
);
`

/**
 * A project shaped like the ones composer writes: a psr-4 map, a classmap, and
 * the files they point at.
 *
 * `classes` is `[name, path from the project root]`: the classmap is what
 * composer wrote, the file is what the walk reads.
 */
const project = ({classes = [], prefixes = [], vendor = []} = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-classes-'))

  write(path.join(root, 'vendor/composer/autoload_psr4.php'), psr4(prefixes))
  write(path.join(root, 'vendor/composer/autoload_classmap.php'), classmap(classes))

  for (const [name, file] of classes) {
    write(path.join(root, file), `<?php // ${name}\n`)
  }

  for (const file of vendor) {
    write(path.join(root, file), '<?php // vendor\n')
  }

  return root
}

describe('the project class index', () => {
  afterEach(() => {
    clearClassIndex()
  })

  test('answers a short name with the one class that carries it', () => {
    const root = project({
      classes: [
        ['App\\Models\\Order', 'app/Models/Order.php'],
        ['App\\Models\\Invoice', 'app/Models/Invoice.php'],
        ['App\\Support\\Helper', 'app/Support/Helper.php'],
      ],
      prefixes: [['App\\\\', "$baseDir . '/app'"]],
    })

    expect(importsFor(root, "Order::where('paid', true)->count();")).toEqual({Order: 'App\\Models\\Order'})
    expect(importsFor(root, 'new Invoice();')).toEqual({Invoice: 'App\\Models\\Invoice'})
    expect(importsFor(root, 'Helper::x();')).toEqual({Helper: 'App\\Support\\Helper'})
  })

  test('leaves a short name two classes carry alone', () => {
    const root = project({
      classes: [
        ['App\\Models\\Order', 'app/Models/Order.php'],
        ['Other\\Order', 'other/Order.php'],
      ],
      prefixes: [['App\\\\', "$baseDir . '/app'"], ['Other\\\\', "$baseDir . '/other'"]],
    })

    expect(importsFor(root, 'Order::where(1);')).toEqual({})
  })

  test('leaves a name it does not know alone, and still answers its neighbour', () => {
    const root = project({
      classes: [['App\\Models\\Order', 'app/Models/Order.php']],
      prefixes: [['App\\\\', "$baseDir . '/app'"]],
    })

    expect(importsFor(root, 'Order::where(1); Str::random(4);')).toEqual({Order: 'App\\Models\\Order'})
  })

  test('is the same for a snippet that writes the name in another case', () => {
    const root = project({
      classes: [['App\\Models\\Order', 'app/Models/Order.php']],
      prefixes: [['App\\\\', "$baseDir . '/app'"]],
    })

    expect(importsFor(root, 'order::where(1);')).toEqual({order: 'App\\Models\\Order'})
  })

  test('walks the psr-4 directories the classmap does not know', () => {
    const root = project({
      classes: [['App\\Models\\Order', 'app/Models/Order.php']],
      prefixes: [['App\\\\', "$baseDir . '/app'"]],
    })

    // a class added after the last `composer dump-autoload` is in no classmap
    write(path.join(root, 'app/Support/FrontendUrl.php'), '<?php // App\\Support\\FrontendUrl\n')

    expect(importsFor(root, "FrontendUrl::passwordSetup('a@b.c', 't');"))
      .toEqual({FrontendUrl: 'App\\Support\\FrontendUrl'})
  })

  test('names a walked file by its directory, so composer can still load it', () => {
    const root = project({
      classes: [['App\\Models\\Order', 'app/Models/Order.php']],
      prefixes: [['App\\\\', "$baseDir . '/app'"]],
    })

    write(path.join(root, 'app/Models/factories/OrderFactory.php'), '<?php // App\\Models\\factories\\OrderFactory\n')

    // composer's own lookup is case sensitive, and a walk spells the namespace
    // the way the directories are spelled, so the two are one class
    expect(importsFor(root, 'OrderFactory::new();')).toEqual({OrderFactory: 'App\\Models\\factories\\OrderFactory'})
  })

  test('does not walk the vendor directories a classmap already covers', () => {
    const root = project({
      classes: [['App\\Models\\Order', 'app/Models/Order.php']],
      prefixes: [['App\\\\', "$baseDir . '/app'"], ['Acme\\\\', "$vendorDir . '/acme/src'"]],
      vendor: ['vendor/acme/src/Gadget.php'],
    })

    expect(importsFor(root, 'Gadget::make(); Order::where(1);')).toEqual({Order: 'App\\Models\\Order'})
  })

  test('walks the vendor directories when there is no classmap', () => {
    const root = project({
      classes: [],
      prefixes: [['App\\\\', "$baseDir . '/app'"], ['Acme\\\\', "$vendorDir . '/acme/src'"]],
      vendor: ['vendor/acme/src/Gadget.php'],
    })

    write(path.join(root, 'app/Models/Order.php'), '<?php // App\\Models\\Order\n')

    expect(importsFor(root, 'Order::where(1); Gadget::make();'))
      .toEqual({Gadget: 'Acme\\Gadget', Order: 'App\\Models\\Order'})
  })

  test('imports nothing when the project has no composer directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-nocomposer-'))

    write(path.join(root, 'app/Models/Order.php'), '<?php // App\\Models\\Order\n')

    expect(classIndex(root)).toBe(null)
    expect(importsFor(root, 'Order::where(1);')).toEqual({})
    expect(importsFor('', 'Order::where(1);')).toEqual({})
    expect(importsFor(undefined, 'Order::where(1);')).toEqual({})
  })

  test('reads the project once and keeps it', () => {
    const root = project({
      classes: [['App\\Models\\Order', 'app/Models/Order.php']],
      prefixes: [['App\\\\', "$baseDir . '/app'"]],
    })

    const index = classIndex(root)

    expect(classIndex(root)).toBe(index)
    expect(classIndex(`${root}/`)).toBe(index)

    // the second run does not look at the project again
    fs.rmSync(path.join(root, 'vendor/composer/autoload_classmap.php'))
    expect(importsFor(root, 'Order::where(1);')).toEqual({Order: 'App\\Models\\Order'})
  })

  test('imports nothing, and does not throw, when the autoload files are broken', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-broken-'))

    write(path.join(root, 'vendor/composer/autoload_psr4.php'), '<?php return array(')
    write(path.join(root, 'vendor/composer/autoload_classmap.php'), '<?php not even php')

    expect(importsFor(root, 'Order::where(1);')).toEqual({})

    const unreadable = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-unreadable-'))

    fs.mkdirSync(path.join(unreadable, 'vendor/composer'), {recursive: true})
    fs.chmodSync(path.join(unreadable, 'vendor/composer'), 0o000)

    try {
      expect(importsFor(unreadable, 'Order::where(1);')).toEqual({})
    } finally {
      fs.chmodSync(path.join(unreadable, 'vendor/composer'), 0o700)
    }
  })

  test('lists the classes a typed name is the beginning of', () => {
    const root = project({
      classes: [
        ['App\\Models\\Order', 'app/Models/Order.php'],
        ['App\\Models\\OrderLine', 'app/Models/OrderLine.php'],
        ['App\\Support\\Helper', 'app/Support/Helper.php'],
      ],
      prefixes: [['App\\\\', "$baseDir . '/app'"]],
    })

    expect(matchingClasses(root, 'Ord')).toEqual([
      {name: 'Order', qualified: 'App\\Models\\Order'},
      {name: 'OrderLine', qualified: 'App\\Models\\OrderLine'},
    ])
    expect(matchingClasses(root, 'ord')).toHaveLength(2)
    expect(matchingClasses(root, 'Helper')).toEqual([{name: 'Helper', qualified: 'App\\Support\\Helper'}])
    expect(matchingClasses(root, 'Nothing')).toEqual([])
  })

  test('reads a prefix that spells out the namespace as the whole name', () => {
    const root = project({
      classes: [
        ['App\\Models\\Order', 'app/Models/Order.php'],
        ['Other\\Models\\Order', 'other/Models/Order.php'],
      ],
      prefixes: [['App\\\\', "$baseDir . '/app'"], ['Other\\\\', "$baseDir . '/other'"]],
    })

    // two classes carry the short name, and the namespace is what tells them
    // apart: both are offered, each with the class it names
    expect(matchingClasses(root, 'Order').map(match => match.qualified))
      .toEqual(['App\\Models\\Order', 'Other\\Models\\Order'])
    expect(matchingClasses(root, 'App\\Models\\Ord'))
      .toEqual([{name: 'Order', qualified: 'App\\Models\\Order'}])
    expect(matchingClasses(root, 'App\\Models\\')).toEqual([{name: 'Order', qualified: 'App\\Models\\Order'}])
    expect(matchingClasses(root, '\\Order').map(match => match.qualified))
      .toEqual(['App\\Models\\Order', 'Other\\Models\\Order'])
  })

  test('holds a popup to the number of names it was asked for', () => {
    const classes = Array.from({length: 60}, (unused, at) => [`App\\Models\\Order${at}`, `app/Models/Order${at}.php`])
    const root = project({
      classes,
      prefixes: [['App\\\\', "$baseDir . '/app'"]],
    })

    const capped = matchingClasses(root, 'Order', 10)

    expect(capped).toHaveLength(10)
    expect(capped.every(match => match.qualified.startsWith('App\\Models\\Order'))).toBe(true)
    // the names read alphabetically, which is what a popup of them should do
    expect(capped.map(match => match.name))
      .toEqual(capped.map(match => match.name).slice().sort((a, b) => a.localeCompare(b)))

    // a prefix of nothing is the whole project, and the popup holds what it was
    // asked to hold
    expect(matchingClasses(root, '')).toHaveLength(40)
  })

  test('names the project\'s own files for an `@`, and none of the vendor directory', () => {
    const root = project({
      classes: [['App\\Models\\Order', 'app/Models/Order.php']],
      prefixes: [['App\\\\', "$baseDir . '/app'"], ['Vendor\\\\Package\\\\', "$vendorDir . '/package/src'"]],
      vendor: ['vendor/package/src/Thing.php'],
    })

    const files = projectFiles(root)

    expect(files.map(one => one.qualified)).toEqual(['App\\Models\\Order'])
    expect(files[0].file).toBe(path.join(root, 'app', 'Models', 'Order.php'))
    expect(files[0].name).toBe('Order')

    // a short name, and a namespace that names the one meant when two share it
    expect(matchingFiles(root, 'Ord').map(one => one.qualified)).toEqual(['App\\Models\\Order'])
    expect(matchingFiles(root, 'App\\Models').map(one => one.qualified)).toEqual(['App\\Models\\Order'])
    expect(matchingFiles(root, 'Nothing')).toEqual([])
  })

  test('offers the files a name is the beginning of in the same order every time', () => {
    const classes = Array.from({length: 12}, (unused, at) => [`App\\Models\\Order${at}`, `app/Models/Order${at}.php`])
    const root = project({classes, prefixes: [['App\\\\', "$baseDir . '/app'"]]})

    const files = matchingFiles(root, 'Order', 5)

    expect(files).toHaveLength(5)
    expect(files.map(one => one.name))
      .toEqual(['Order0', 'Order1', 'Order10', 'Order11', 'Order2'])
  })

  test('has no files to offer when the project has no composer directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-nocomposer-files-'))

    expect(projectFiles(root)).toEqual([])
    expect(matchingFiles(root, 'Order')).toEqual([])
  })

  test('has no names to suggest when the project has no composer directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-nocomposer-names-'))

    expect(matchingClasses(root, 'Order')).toEqual([])
    expect(matchingClasses(undefined, 'Order')).toEqual([])
  })
})

/**
 * The rule both machines read a project with: this one through the files it
 * walks, the machine on the other side of an ssh connection through the paths
 * its php lists. The cases here are the answers without a project to read them
 * from, which is the only shape the other machine can send.
 */
describe('the index composer\'s answers make', () => {
  test('is the whole of what building the project amounts to', () => {
    const root = project({
      classes: [
        ['App\\Models\\Order', 'app/Models/Order.php'],
        ['App\\Support\\Helper', 'app/Support/Helper.php'],
      ],
      prefixes: [['App\\\\', "$baseDir . '/app'"]],
    })

    // the same project, as the two machines describe it: the composer files
    // read, the walk done, and the naming left to the one rule
    expect(classIndex(root)).toEqual(indexFrom({
      classmap: ['App\\Models\\Order', 'App\\Support\\Helper'],
      psr4: {'App\\': [path.join(root, 'app')]},
      files: [
        path.join(root, 'app', 'Models', 'Order.php'),
        path.join(root, 'app', 'Support', 'Helper.php'),
      ],
      vendor: path.join(root, 'vendor'),
    }))
  })

  test('reads the paths of another machine\'s project as the classes they hold', () => {
    const found = indexFrom({
      classmap: ['App\\Models\\Order'],
      psr4: {'App\\': ['app']},
      files: ['app/Models/Order.php', 'app/Support/JustCreated.php'],
      vendor: 'vendor',
    })

    // the classmap is a moment in the project's life, and the file a class that
    // came after it is in is what makes the name answerable
    expect(Array.from(found.index.get('justcreated'))).toEqual(['App\\Support\\JustCreated'])
    expect(Array.from(found.index.get('order'))).toEqual(['App\\Models\\Order'])
    expect(found.own).toEqual(['app\\'])
    expect(found.files).toEqual([
      {name: 'JustCreated', qualified: 'App\\Support\\JustCreated', file: 'app/Support/JustCreated.php'},
      {name: 'Order', qualified: 'App\\Models\\Order', file: 'app/Models/Order.php'},
    ])
  })

  test('names a class of a path composer\'s map spells its own way', () => {
    const found = indexFrom({
      classmap: [],
      psr4: {'Database\\Factories\\': ['database/factories']},
      files: ['database/factories/OrderFactory.php'],
    })

    expect(Array.from(found.index.get('orderfactory'))).toEqual(['Database\\Factories\\OrderFactory'])
  })

  test('names nothing for a path php does not let a class be called', () => {
    const found = indexFrom({
      classmap: [],
      psr4: {'App\\': ['app']},
      files: [
        'app/Models/Order.php',
        'app/Models/order-line.php',
        'app/node_modules/thing/Order.php',
        'app/.hidden/Order.php',
        'app/Models/Order.php.txt',
      ],
    })

    expect(found.files.map(one => one.qualified)).toEqual(['App\\Models\\Order'])
  })

  test('keeps a package\'s files out of the project\'s own', () => {
    const found = indexFrom({
      classmap: [],
      psr4: {'App\\': ['app'], 'Acme\\': ['vendor/acme/src']},
      files: ['app/Models/Order.php', 'vendor/acme/src/Gadget.php'],
      vendor: 'vendor',
    })

    // a package's names are ones a snippet can call, so they are in the index,
    // and one of them is nothing anyone is working on, so it is in no file list
    expect(Array.from(found.index.get('gadget'))).toEqual(['Acme\\Gadget'])
    expect(found.files.map(one => one.qualified)).toEqual(['App\\Models\\Order'])
    expect(found.own).toEqual(['app\\'])
  })

  test('walks no package directory of a project a classmap has already named', () => {
    const found = indexFrom({
      classmap: ['Acme\\Gadget'],
      psr4: {'App\\': ['app'], 'Acme\\': ['vendor/acme/src']},
      files: ['app/Models/Order.php', 'vendor/acme/src/Gadget.php'],
      vendor: 'vendor',
    })

    expect(Array.from(found.index.get('gadget'))).toEqual(['Acme\\Gadget'])
    expect(found.files.map(one => one.qualified)).toEqual(['App\\Models\\Order'])
  })

  test('reads a class of the global namespace as the name a snippet writes', () => {
    const found = indexFrom({classmap: ['Order']})

    // `Order` is already what a snippet writes, so there is no short name to
    // look up, and the classmap names no file of the project's own
    expect(found.index.has('order')).toBe(false)
    expect(found.files).toEqual([])
  })

  test('makes one class of two spellings of the name, the one the classmap wrote', () => {
    const found = indexFrom({
      classmap: ['App\\Models\\Order'],
      psr4: {'App\\': ['app']},
      files: ['app/models/order.php'],
    })

    expect(Array.from(found.index.get('order'))).toEqual(['App\\Models\\Order'])
  })

  test('answers an empty index for a project with no answers at all', () => {
    const found = indexFrom()

    expect(found.index.size).toBe(0)
    expect(found.own).toEqual([])
    expect(found.files).toEqual([])
  })
})

describe('the classes an index offers a typed name', () => {
  const found = indexFrom({
    classmap: ['Illuminate\\Support\\Arr', 'App\\Models\\Order', 'Other\\Order'],
    psr4: {'App\\': ['app']},
    files: ['app/Models/Order.php'],
    vendor: 'vendor',
  })

  test('reads the typed name as a short name or as a whole one', () => {
    expect(matchingIn(found, 'Ord').map(one => one.qualified))
      .toEqual(['App\\Models\\Order', 'Other\\Order'])
    expect(matchingIn(found, 'App\\Models\\Or')).toEqual([{name: 'Order', qualified: 'App\\Models\\Order'}])
    expect(matchingIn(found, '\\Other\\Order')).toEqual([{name: 'Order', qualified: 'Other\\Order'}])
    expect(matchingIn(found, 'Nothing')).toEqual([])
  })

  test('offers the project\'s own namespaces before a package\'s', () => {
    expect(matchingIn(found, 'Or').map(one => one.qualified)[0]).toBe('App\\Models\\Order')
  })

  test('holds a popup to the number of names it was asked for', () => {
    expect(matchingIn(found, 'Or', 1)).toHaveLength(1)
    expect(matchingIn(found, '')).toHaveLength(3)
  })

  test('offers nothing for a project there is no index of', () => {
    expect(matchingIn(null, 'Ord')).toEqual([])
    expect(matchingIn(undefined, 'Ord')).toEqual([])
  })
})

describe('the files an index offers a prompt', () => {
  const found = indexFrom({
    classmap: [],
    psr4: {'App\\': ['app']},
    files: ['app/Models/Order.php', 'app/Models/OrderLine.php'],
  })

  test('takes what is typed after an `@` as the beginning of a name', () => {
    expect(matchingFilesIn(found, 'Order').map(one => one.qualified))
      .toEqual(['App\\Models\\Order', 'App\\Models\\OrderLine'])
    expect(matchingFilesIn(found, 'App\\Models\\OrderL').map(one => one.qualified))
      .toEqual(['App\\Models\\OrderLine'])
    expect(matchingFilesIn(found, 'Nothing')).toEqual([])
  })

  test('holds the list to the number of files it was asked for', () => {
    expect(matchingFilesIn(found, 'Order', 1)).toHaveLength(1)
    expect(matchingFilesIn(null, 'Order')).toEqual([])
  })
})
