const fs = require('fs')
const path = require('path')

const {bareClassNames} = require('./phpScanner')

/**
 * The project's classes, by the name a snippet is likely to call them.
 *
 * Composer already knows them, so the index is read from the autoload files the
 * project generated rather than from the project tree:
 *
 *   vendor/composer/autoload_psr4.php      `App\` => `app/`, and every vendor package
 *   vendor/composer/autoload_classmap.php  class => file, when composer wrote one
 *
 * The classmap is what an optimized autoloader writes (a Laravel project asks
 * for one) and it is the whole project in one file, so it is the index whenever
 * it has entries. It goes stale the moment a class is added without a
 * `composer dump-autoload` though, so the project's own psr-4 directories are
 * walked as well and are what makes a model that was just created resolve. When
 * there is no classmap at all the vendor psr-4 directories are walked too,
 * since nothing else names what lives there.
 *
 * The build reads a megabyte of generated php and walks directories, so it
 * happens once per project and is kept: a run is one lookup.
 *
 * @type {Map<String, Map<String, Set<String>>|null>}
 */
const indexes = new Map()

// generated files are arrays of `'Key' => $dir . '/path'` with `\\` escapes; a
// php parser here would be a second language to learn, the shape is fixed
const entryPattern = /'((?:[^'\\]|\\.)*)'\s*=>\s*\$(vendorDir|baseDir)\s*\.\s*'((?:[^'\\]|\\.)*)'/g

const unescape = value => value.replace(/\\(.)/g, '$1')

const read = file => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (e) {
    return null
  }
}

/**
 * The classes composer's classmap names, in the order it wrote them.
 *
 * @param {String} file `autoload_classmap.php`
 * @return {Array<String>}
 */
const classmapNames = file => {
  const source = read(file)

  if (!source) {
    return []
  }

  const names = []

  let match

  entryPattern.lastIndex = 0

  while ((match = entryPattern.exec(source))) {
    names.push(unescape(match[1]))
  }

  return names
}

/**
 * The psr-4 map: namespace prefix to the directories under it.
 *
 * @param {String} file
 * @param {String} projectPath
 * @return {Array<{prefix: String, dir: String}>}
 */
const psr4Of = (file, projectPath) => {
  const source = read(file)

  if (!source) {
    return []
  }

  const map = []
  const entries = /'((?:[^'\\]|\\.)*)'\s*=>\s*array\(([^)]*)\)/g
  const dirs = {
    vendorDir: path.join(projectPath, 'vendor'),
    baseDir: projectPath,
    __DIR__: path.join(projectPath, 'vendor', 'composer'),
  }

  let entry

  entries.lastIndex = 0

  while ((entry = entries.exec(source))) {
    const prefix = unescape(entry[1])
    const list = /\$([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*'((?:[^'\\]|\\.)*)'/g

    let dir

    while ((dir = list.exec(entry[2]))) {
      if (!dirs[dir[1]]) {
        continue
      }

      map.push({prefix, dir: path.join(dirs[dir[1]], unescape(dir[2]))})
    }
  }

  return map
}

/**
 * `readdir` says a symlink is a symlink, not what it points at.
 *
 * @param {fs.Dirent} child
 * @param {String} full
 * @return {Boolean}
 */
const isDirectory = (child, full) => {
  if (child.isDirectory()) {
    return true
  }

  if (!child.isSymbolicLink()) {
    return false
  }

  try {
    return fs.statSync(full).isDirectory()
  } catch (e) {
    return false
  }
}

/**
 * Every `.php` file under the directory, as namespace segments.
 *
 * A psr-4 file is named after the class it holds and sits under the prefix, so
 * the path is the class name: reading the file would only confirm what psr-4
 * promises.
 *
 * @param {String} dir
 * @param {String} namespace the prefix plus the directories walked into
 * @param {Function} add what to call with each name found
 * @param {Set<String>} seen the directories already walked, by real path
 */
const walk = (dir, namespace, add, seen = new Set()) => {
  let children

  try {
    // a package can be a symlink add a path repository, and two of them can
    // point at the same directory: walking it once is enough
    const real = fs.realpathSync(dir)

    if (seen.has(real)) {
      return
    }

    seen.add(real)
    children = fs.readdirSync(dir, {withFileTypes: true})
  } catch (e) {
    // a psr-4 directory that is not there names nothing
    return
  }

  for (const child of children) {
    const full = path.join(dir, child.name)

    if (isDirectory(child, full)) {
      if (!child.name.startsWith('.') && child.name !== 'node_modules' &&
        /^[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*$/.test(child.name)) {
        walk(full, `${namespace}${child.name}\\`, add, seen)
      }

      continue
    }

    if (!child.isFile() || !child.name.endsWith('.php')) {
      continue
    }

    const name = child.name.slice(0, -4)

    if (/^[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*$/.test(name)) {
      add(namespace + name)
    }
  }
}

/**
 * Short name to the fully qualified names that carry it, so a name with one
 * candidate is answerable and a name with two is not.
 *
 * php looks a class up without regard to case, and a psr-4 path spells the
 * namespace of a class in its directory names, which composer's own map may
 * spell differently (`Database\Factories\` sits in `database/factories`, so the
 * walk names `Database\factories\…`). One class written two ways is one
 * candidate, and it is the one the classmap wrote that is kept: that spelling
 * is the one composer, which is stricter than php, will load.
 *
 * @param {String} projectPath
 * @return {Map<String, Set<String>>} by lowercased short name, which is how a
 * snippet's `Order` and `order` are the same class
 */
const build = projectPath => {
  const composer = path.join(projectPath, 'vendor', 'composer')
  const psr4 = psr4Of(path.join(composer, 'autoload_psr4.php'), projectPath)
  const classmap = classmapNames(path.join(composer, 'autoload_classmap.php'))
  const vendor = path.join(projectPath, 'vendor')
  const classes = new Map()

  const add = name => {
    const key = name.toLowerCase()

    if (!classes.has(key)) {
      classes.set(key, name)
    }
  }

  classmap.forEach(add)

  for (const {prefix, dir} of psr4) {
    // the map covers the whole vendor directory, and its names are already in
    // the classmap when composer wrote one
    if (dir.startsWith(vendor + path.sep) && classmap.length > 0) {
      continue
    }

    walk(dir, prefix, add)
  }

  const index = new Map()

  for (const name of classes.values()) {
    // a class in the global namespace is already the name a snippet writes
    if (!name.includes('\\')) {
      continue
    }

    const short = name.split('\\').pop().toLowerCase()

    if (!index.has(short)) {
      index.set(short, new Set())
    }

    index.get(short).add(name)
  }

  // the namespaces the project declares itself, which is what a snippet is
  // almost always after: a vendor directory holds thousands of names and would
  // otherwise bury the handful the app is written in
  const own = psr4
    .filter(({dir}) => !dir.startsWith(vendor + path.sep))
    .map(({prefix}) => prefix.toLowerCase())

  return {index, own}
}

/**
 * @param {String} projectPath
 * @return {Map<String, Set<String>>|null} null when the project has no composer
 * directory, which is a run that has nothing to look names up in
 */
const classIndex = projectPath => {
  if (!projectPath) {
    return null
  }

  const at = path.resolve(projectPath)

  if (!indexes.has(at)) {
    indexes.set(at, fs.existsSync(path.join(at, 'vendor', 'composer')) ? build(at) : null)
  }

  return indexes.get(at)
}

/**
 * The classes to alias into the session for a snippet, by short name.
 *
 * Only a name with exactly one candidate is answered: with two, `Order` could
 * be either and guessing would run something other than what was written.
 *
 * @param {String} projectPath the directory the session runs in
 * @param {String} code the snippet, as the editor holds it
 * @return {Object<String, String>}
 */
const importsFor = (projectPath, code) => {
  const imports = {}

  try {
    const found = classIndex(projectPath)

    if (!found) {
      return imports
    }

    const {index} = found

    for (const name of bareClassNames(code)) {
      const candidates = index.get(name.toLowerCase())

      if (candidates && candidates.size === 1) {
        imports[name] = Array.from(candidates)[0]
      }
    }
  } catch (e) {
    // an unreadable project, a broken autoload file, anything: the run goes on
    // exactly as it does today and imports nothing
    return {}
  }

  return imports
}

/**
 * @param {String} name
 * @return {String}
 */
const shortOf = name => name.split('\\').pop()

/**
 * The project's classes a name being typed is the beginning of, for the
 * editor's completion popup.
 *
 * A prefix that already spells part of the namespace (`App\Models\Tea`) matches
 * the whole name, which is what tells two classes of the same short name apart;
 * a bare one (`Tea`) matches the short name, since that is all a snippet needs
 * to write.
 *
 * The list is capped: one letter would otherwise be the whole vendor directory,
 * and a popup of four thousand rows is not a suggestion.
 *
 * @param {String} projectPath
 * @param {String} [prefix] what has been typed
 * @param {Number} [limit]
 * @return {Array<{name: String, qualified: String}>} the short name to insert,
 * and the class it names
 */
const matchingClasses = (projectPath, prefix = '', limit = 40) => {
  const found = classIndex(projectPath)

  if (!found) {
    return []
  }

  const {index, own} = found

  // `\Order` is php's way of saying the global namespace, and composer's map
  // does not list the global namespace: what is left is the name to match
  const typed = prefix.replace(/^\\+/, '').toLowerCase()
  const namespaced = typed.includes('\\')
  const matches = []

  // the index is a Map, so the walk is in the order the project was read: the
  // sort below is what makes a popup for the same prefix the same every time
  for (const qualified of index.values()) {
    for (const name of qualified) {
      if (namespaced ? name.toLowerCase().startsWith(typed) : shortOf(name).toLowerCase().startsWith(typed)) {
        const lower = name.toLowerCase()

        matches.push({
          name: shortOf(name),
          qualified: name,
          // the project's own namespaces come first: a vendor directory holds
          // thousands of names and would bury what the app is written in
          own: own.some(root => lower.startsWith(root)),
        })
      }
    }
  }

  matches.sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0) ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
    a.qualified.localeCompare(b.qualified))

  return matches.slice(0, limit).map(({name, qualified}) => ({name, qualified}))
}

/**
 * Forget what has been indexed; the tests build a project per case.
 */
const clearClassIndex = () => {
  indexes.clear()
}

module.exports = {
  classIndex,
  matchingClasses,
  importsFor,
  clearClassIndex,
}
