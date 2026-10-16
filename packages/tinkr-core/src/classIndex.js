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
 * What is read here is this machine's copy of the project. A connection over ssh
 * has another copy, on the machine its session runs on, where these files are
 * not here to read: that machine is asked for the same answers as data, and
 * `indexFrom` — the naming rule both copies have to agree on — is what reads
 * them, so a class is named the same way whichever machine answered.
 *
 * @type {Map<String, {index: Map<String, Set<String>>, own: Array<String>,
 *   files: Array<Object>}|null>}
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

// what php lets a namespace segment, and so a class's short name, be called
const isName = value => /^[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*$/.test(value)

// a directory no class of the project is in: a dot directory holds a tool's own
// files and a node_modules holds javascript, and walking either is walking a
// package
const isSkipped = value => value.startsWith('.') || value === 'node_modules'

/**
 * Every `.php` file under the directory, as paths.
 *
 * The walk names nothing: what a path stands for is `indexFrom`'s rule, and the
 * machine on the other side of an ssh connection answers with paths of its own
 * that the same rule has to read the same way. It prunes only what would be a
 * waste to walk, and it prunes by the rule the index drops those files by.
 *
 * @param {String} dir
 * @param {Array<String>} [files] what has been found so far
 * @param {Set<String>} [seen] the directories already walked, by real path
 * @return {Array<String>}
 */
const walk = (dir, files = [], seen = new Set()) => {
  let children

  try {
    // a package can be a symlink add a path repository, and two of them can
    // point at the same directory: walking it once is enough
    const real = fs.realpathSync(dir)

    if (seen.has(real)) {
      return files
    }

    seen.add(real)
    children = fs.readdirSync(dir, {withFileTypes: true})
  } catch (e) {
    // a psr-4 directory that is not there names nothing
    return files
  }

  for (const child of children) {
    const full = path.join(dir, child.name)

    if (isDirectory(child, full)) {
      if (!isSkipped(child.name)) {
        walk(full, files, seen)
      }

      continue
    }

    if (child.isFile() && child.name.endsWith('.php')) {
      files.push(full)
    }
  }

  return files
}

/**
 * The class a psr-4 file holds, from the path it sits at.
 *
 * A psr-4 file is named after the class it holds and sits under the prefix, so
 * the path is the class name: reading the file would only confirm what psr-4
 * promises.
 *
 * @param {String} file
 * @param {String} dir the psr-4 directory
 * @param {String} prefix the namespace that directory stands for
 * @return {String|null} null when the file is not one under the directory, or
 * when its path spells something php does not let a class be called
 */
const nameOf = (file, dir, prefix) => {
  if (!(file.startsWith(`${dir}/`) || file.startsWith(`${dir}${path.sep}`)) || !file.endsWith('.php')) {
    return null
  }

  const segments = file.slice(dir.length).replace(/^[\\/]+/, '').slice(0, -4).split(/[\\/]/)

  if (!segments.length || segments.some(segment => isSkipped(segment) || !isName(segment))) {
    return null
  }

  return prefix + segments.join('\\')
}

/**
 * The index these answers make, without reading anything: the class names
 * composer's classmap lists, its psr-4 map, and the `.php` files under those
 * directories.
 *
 * It is one rule for both machines, which is the point of it: here the classmap
 * is a generated file and the files are what a walk found, and over ssh a php
 * program reads the same files and lists the same paths, so the naming — the
 * part that has to agree — happens in this one place.
 *
 * The paths are the caller's own spelling of the project, because the two
 * machines have the same project under two names: absolute here, relative to the
 * project over ssh.
 *
 * @param {Object} [answers]
 * @param {Array<String>} [answers.classmap] the class names composer's classmap
 * lists, in the order it wrote them
 * @param {Object<String, Array<String>>} [answers.psr4] namespace prefix to the
 * directories under it
 * @param {Array<String>} [answers.files] the paths of the `.php` files under them
 * @param {String|null} [answers.vendor] the directory that holds the packages,
 * which is what tells a package's files from the project's own
 * @return {{index: Map<String, Set<String>>, own: Array<String>,
 *   files: Array<{name: String, qualified: String, file: String}>}}
 */
const indexFrom = ({classmap = [], psr4 = {}, files = [], vendor = null} = {}) => {
  const underVendor = value => vendor !== null && (value === vendor ||
    value.startsWith(`${vendor}/`) || value.startsWith(`${vendor}${path.sep}`))

  const classes = new Map()
  // the project's own classes with the file each one is in, which is what an `@`
  // in a prompt is resolved against: a name the vendor directory declared is
  // nothing anyone is working on
  const listed = []
  const seenFiles = new Set()

  const add = (name, file) => {
    const key = name.toLowerCase()

    if (!classes.has(key)) {
      classes.set(key, name)
    }

    if (!file || seenFiles.has(file) || underVendor(file)) {
      return
    }

    seenFiles.add(file)
    listed.push({name: name.split('\\').pop(), qualified: name, file})
  }

  for (const name of classmap) {
    add(name, null)
  }

  for (const [prefix, dirs] of Object.entries(psr4)) {
    for (const dir of dirs) {
      // the map covers the whole vendor directory, and its names are already in
      // the classmap when composer wrote one
      if (underVendor(dir) && classmap.length > 0) {
        continue
      }

      for (const file of files) {
        const name = nameOf(file, dir, prefix)

        if (name !== null) {
          add(name, file)
        }
      }
    }
  }

  // the walk is in the order the file system answered in: a picker for the same
  // name has to offer the same rows every time
  listed.sort((one, other) => one.name.localeCompare(other.name) || one.qualified.localeCompare(other.qualified))

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
  const own = Object.keys(psr4)
    .filter(prefix => psr4[prefix].some(dir => !underVendor(dir)))
    .map(prefix => prefix.toLowerCase())

  return {index, own, files: listed}
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
 * @return {{index: Map<String, Set<String>>, own: Array<String>,
 *   files: Array<Object>}|null} null when the project has no composer directory
 */
const build = projectPath => {
  const composer = path.join(projectPath, 'vendor', 'composer')
  const psr4 = psr4Of(path.join(composer, 'autoload_psr4.php'), projectPath)
  const classmap = classmapNames(path.join(composer, 'autoload_classmap.php'))
  const dirs = {}
  const files = []
  // a directory two prefixes share is one directory to walk
  const seen = new Set()

  for (const {prefix, dir} of psr4) {
    // a prefix can stand for more than one directory, and the map both machines
    // can spell is the prefix to the directories under it
    if (!dirs[prefix]) {
      dirs[prefix] = []
    }

    if (!dirs[prefix].includes(dir)) {
      dirs[prefix].push(dir)
    }

    files.push(...walk(dir, [], seen))
  }

  return indexFrom({classmap, psr4: dirs, files, vendor: path.join(projectPath, 'vendor')})
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
const matchingClasses = (projectPath, prefix = '', limit = 40) =>
  matchingIn(classIndex(projectPath), prefix, limit)

/**
 * The classes of an index a name being typed is the beginning of.
 *
 * It is the one rule, and it takes an index rather than a path because the index
 * of a project over ssh is read from the machine that project is on.
 *
 * @param {{index: Map<String, Set<String>>, own: Array<String>}|null} found what
 * an index build answered, or null for a project there is nothing to look up in
 * @param {String} [prefix] what has been typed
 * @param {Number} [limit]
 * @return {Array<{name: String, qualified: String}>} the short name to insert,
 * and the class it names
 */
const matchingIn = (found, prefix = '', limit = 40) => {
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
 * The project's own php classes with the file each one is in, which is what an
 * `@` in an AI prompt names.
 *
 * @param {String} projectPath
 * @return {Array<{name: String, qualified: String, file: String}>}
 */
const projectFiles = projectPath => {
  const found = classIndex(projectPath)

  return found ? found.files : []
}

/**
 * The project's files whose name is the beginning of what is typed after an `@`,
 * and the qualified name for the ones written out in full.
 *
 * @param {String} projectPath
 * @param {String} [prefix] what has been typed, without the `@`
 * @param {Number} [limit]
 * @return {Array<{name: String, qualified: String, file: String}>}
 */
const matchingFiles = (projectPath, prefix = '', limit = 10) =>
  matchingFilesIn(classIndex(projectPath), prefix, limit)

/**
 * The files of an index whose name is the beginning of what is typed after an
 * `@`, and the qualified name for the ones written out in full.
 *
 * @param {{files: Array<Object>}|null} found what an index build answered, or
 * null for a project there is nothing to look up in
 * @param {String} [prefix] what has been typed, without the `@`
 * @param {Number} [limit]
 * @return {Array<{name: String, qualified: String, file: String}>}
 */
const matchingFilesIn = (found, prefix = '', limit = 10) => {
  // `\App\Models\User`, the way php writes a name in full
  const typed = String(prefix || '').replace(/^\\+/, '').toLowerCase()
  const matches = (found ? found.files : []).filter(({name, qualified}) =>
    name.toLowerCase().startsWith(typed) || qualified.toLowerCase().startsWith(typed))

  return matches.sort((one, other) =>
    one.name.toLowerCase().localeCompare(other.name.toLowerCase()) ||
    one.qualified.localeCompare(other.qualified)).slice(0, limit)
}

/**
 * Forget what has been indexed; the tests build a project per case.
 */
const clearClassIndex = () => {
  indexes.clear()
}

module.exports = {
  classIndex,
  indexFrom,
  matchingClasses,
  matchingIn,
  projectFiles,
  matchingFiles,
  matchingFilesIn,
  importsFor,
  clearClassIndex,
}
