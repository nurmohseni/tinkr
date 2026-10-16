const {
  stripNonCode,
  importedClasses,
  phpString,
  matchingIn,
} = require('tinkr-core')

const {getEditorConnection, getBackgroundPtyProcess} = require('./processes')
const {ensureBackgroundPty} = require('./createBackgroundPty')
const {indexFor} = require('./services/project')

/**
 * What the editor's suggestion popup shows: the project's class names while a
 * name is being typed, and the public methods of the class a `::` is called on.
 *
 * Class names come from the connection's project index (see services/project),
 * which is composer's own answer to "what does this project declare", read from
 * this machine for a local project and put to the session for one over ssh.
 * Methods come from the session's reflection instead, because only the session
 * has the class loaded: a `Teatro` that a package or a macro adds to is not in
 * any file the project has, and reflection is exact where reading the source is
 * a guess. Both questions are answered on the machine the connection runs on, so
 * a project over ssh suggests what that machine holds — its own copy, which is
 * the one a run there would load.
 *
 * Two questions the popup never answers: a name that stands for two classes, and
 * the member of a `->`. Nothing knows which of the two classes a snippet means,
 * and nothing knows the type of a variable before the snippet runs, so both are
 * an empty popup rather than a list that could be wrong.
 */

// what php lets a class, a method and a namespace segment be called
const nameStart = '[A-Za-z_\\x80-\\xff]'
const namePart = '[A-Za-z0-9_\\x80-\\xff]'
const segment = `${nameStart}${namePart}*`
const qualified = `\\\\?${segment}(?:\\\\${segment})*`

// `Teatro::whe`, and `App\Models\Teatro::` before it: the class a member is asked
// of, and what has been typed of the member
const staticAccess = new RegExp(`(${qualified})::(${segment})?$`)

// `$x->whe`: a member of a variable, which is not a question this can answer
const memberAccess = new RegExp(`(?:->|\\?->)(?:${segment})?$`)

// the name being typed, a namespace separator included: `App\Models\Tea` is what
// the completion of `App\Models\` and of `Tea` both start from
const partialName = new RegExp(`(${qualified}\\\\?)$`)

// how many names a popup holds: one letter of a vendor directory is thousands
const nameLimit = 40

/**
 * @param {String} connectionId
 * @param {{code: String, offset: Number, triggerCharacter: String}} request
 * what the editor holds before the cursor
 * @return {Promise<{items: Array<Object>}>} never rejects: a suggestion is not
 * worth an error where the typing goes
 */
const phpCompletions = async (connectionId, request = {}) => {
  const {code = '', offset = 0, triggerCharacter} = request
  const connection = getEditorConnection(connectionId)

  if (!connection) {
    return {items: []}
  }

  try {
    // the code before the cursor is all the completion is about, and it is what
    // holds the snippet's own `use` statements
    const before = stripNonCode(code.slice(0, offset))
    const access = staticAccess.exec(before)

    if (access) {
      return {items: await methodItems(connection, before, access[1], access[2] || '')}
    }

    if (memberAccess.test(before)) {
      return {items: []}
    }

    return {items: await classNameItems(connection, typedName(before), triggerCharacter)}
  } catch (e) {
    return {items: []}
  }
}

/**
 * @param {String} before the code before the cursor, stripped
 * @return {String|null} what has been typed of a name, `''` when nothing, null
 * when the cursor is not in a name at all
 */
const typedName = before => {
  const match = partialName.exec(before)

  return match ? match[1] : null
}

/**
 * @param {Object} connection
 * @param {String} typed
 * @param {String} [triggerCharacter] what monaco was typed to open the popup
 * @return {Promise<Array<Object>>}
 */
const classNameItems = async (connection, typed, triggerCharacter) => {
  // `App\Models\` asks for the project's names, but a `:` or a `->` with nothing
  // typed after it does not: an empty popup is better than the alphabet
  if (typed === null || typed === '') {
    return []
  }

  return matchingIn(await indexFor(connection), typed, nameLimit).map(({name, qualified: full}) => ({
    type: 'class',
    label: name,
    detail: full,
    filter: name,
    insert: name,
  }))
}

/**
 * @param {Object} connection
 * @param {String} before the code before the cursor, stripped
 * @param {String} written the class name as it is written
 * @param {String} typed what has been typed of the member after the `::`
 * @return {Promise<Array<Object>>}
 */
const methodItems = async (connection, before, written, typed) => {
  const qualifiedName = await resolveClass(connection, before, written)

  if (qualifiedName === null) {
    return []
  }

  const pty = backgroundSession(connection.id)

  if (!pty) {
    return []
  }

  const methods = await reflectedMethods(pty, qualifiedName)
  const needle = typed.toLowerCase()

  return methods.filter(method => !needle || method.filter.toLowerCase().startsWith(needle))
}

/**
 * The class a written name stands for.
 *
 * @param {Object} connection
 * @param {String} before the code before the cursor, stripped
 * @param {String} written
 * @return {Promise<String|null>} the fully qualified name, or null when the name
 * does not say which class it is
 */
const resolveClass = async (connection, before, written) => {
  const name = written.replace(/^\\+/, '')

  // `App\Models\Teatro` already says where the class is
  if (written.includes('\\')) {
    return name
  }

  // a `use` statement in the snippet answers for the name itself, and it is the
  // name the run will call too
  const imported = importedClasses(before).get(written.toLowerCase())

  if (imported) {
    return imported
  }

  const found = await indexFor(connection)
  const candidates = found ? found.index.get(name.toLowerCase()) : null

  // one class carries the name, or none does: two are not a guess to make
  return candidates && candidates.size === 1 ? Array.from(candidates)[0] : null
}

/**
 * The background session of the connection, booted if this connection has none
 * running — a run replaces the session, and the popup then asks the new one.
 *
 * @param {String} id
 * @return {BackgroundPty|null}
 */
const backgroundSession = id => {
  ensureBackgroundPty(id)

  return getBackgroundPtyProcess(id) || null
}

/**
 * What the session has already been asked, per session.
 *
 * The key is the session itself, so a run — which boots a new session, which is
 * how the app makes a class that changed on disk run again — cannot be answered
 * with what the session before it said, and the entries of a session that is
 * gone go with it.
 *
 * @type {WeakMap<BackgroundPty, Map<String, Promise<Array<Object>>>>}
 */
const methodCache = new WeakMap()

/**
 * The public methods of a class, as the session itself sees them.
 *
 * @param {BackgroundPty} pty
 * @param {String} qualifiedName
 * @return {Promise<Array<Object>>} the completion items, empty when the session
 * cannot answer; never rejects
 */
const reflectedMethods = (pty, qualifiedName) => {
  let cache = methodCache.get(pty)

  if (!cache) {
    cache = new Map()
    methodCache.set(pty, cache)
  }

  if (!cache.has(qualifiedName)) {
    // the promise is what is kept, so the keystrokes of a class name that is
    // still typing are one question to the session and not one question each
    cache.set(qualifiedName, asked(pty, qualifiedName).then(methods => {
      if (methods === null) {
        // not an answer at all — the session went away — so the next keystroke
        // asks the session that is there then
        cache.delete(qualifiedName)

        return []
      }

      return methods
    }))
  }

  return cache.get(qualifiedName)
}

/**
 * @param {BackgroundPty} pty
 * @param {String} qualifiedName
 * @return {Promise<Array<Object>|null>} null when the session did not answer
 */
const asked = async (pty, qualifiedName) => {
  try {
    // the reflection comes back as the value of the form, and the session prints
    // it for the form's own reader rather than for whoever is looking at the
    // terminal: nothing of it is ever displayed as a screenful, so there is
    // nothing for a pager to hold, and the answer of a session over ssh is the
    // answer of any other session
    return methodsOf(JSON.parse(await pty.jsonResult(reflectionCode(qualifiedName))))
  } catch (e) {
    // the session was restarted mid-question, its boot never came up, or the
    // class is one it cannot reflect
    return null
  }
}

/**
 * @param {Object} answer what the session printed
 * @return {Array<Object>}
 */
const methodsOf = answer => {
  // the class is not one this session can load, which is an answer: the popup is
  // empty, and there is nothing to ask again for
  if (!answer || !Array.isArray(answer.methods)) {
    return []
  }

  return answer.methods.filter(method => method && method.name).map(methodItem)
}

/**
 * One public method as the popup shows it: the parameters it takes in the label,
 * what it returns as the detail, and the call itself as what is inserted.
 *
 * The parameters that have to be given become the snippet's placeholders, in
 * order, so the caret starts in the first one; a method that can be called with
 * nothing is inserted as an empty pair of brackets.
 *
 * @param {Object} method what reflection reported
 * @return {Object}
 */
const methodItem = method => {
  const parameters = method.parameters || []
  const placeholders = parameters
    .filter(parameter => !parameter.optional)
    .map((parameter, at) => `\${${at + 1}:${parameter.name}}`)
    .join(', ')

  return {
    type: 'method',
    label: `${method.name}(${writtenParameters(parameters)})`,
    detail: method.return ? shortType(method.return) : '',
    filter: method.name,
    insert: placeholders ? `${method.name}(${placeholders})` : `${method.name}()`,
    snippet: Boolean(placeholders),
  }
}

/**
 * A parameter list the way a php signature writes it, with what may be left out
 * in brackets: nothing else in a popup row says which arguments can be skipped.
 *
 * @param {Array<Object>} parameters
 * @return {String}
 */
const writtenParameters = parameters => parameters.map(parameter => {
  const name = `${parameter.variadic ? '...' : ''}$${parameter.name}`
  const written = [parameter.type ? shortType(parameter.type) : null, name].filter(Boolean).join(' ')

  return parameter.optional ? `[${written}]` : written
}).join(', ')

/**
 * A php type as a person reads it: the namespace is what the short name in the
 * snippet stands for, and it is the class name that tells `Order` from `User`.
 *
 * @param {String} type
 * @return {String}
 */
const shortType = type => type.replace(
  /(?:\\?[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*\\)+([A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)/g,
  '$1',
)

/**
 * The php that asks the session for a class.
 *
 * It is one line, because it is written into the session the way any other input
 * is. `ReflectionClass` is the class as php has it — inherited methods and trait
 * methods included — and it is the only thing that knows what a class a package
 * or a `use` statement brings in really holds. A class that is not there is an
 * answer too, not an error the popup should show.
 *
 * It returns the reflection, and the form prints it the way it prints any other
 * value: the whole of a class reaches the editor without the session having to
 * display a screenful of it, which is what a pager would stop on if it were
 * displayed (see BackgroundPty.jsonResult).
 *
 * @param {String} qualifiedName
 * @return {String}
 */
const reflectionCode = qualifiedName => 'function(){' +
  'try{$tinkr_reflection=new \\ReflectionClass(' + phpString(qualifiedName) + ');}' +
  "catch(\\Throwable $tinkr_missing){return ['error'=>$tinkr_missing->getMessage()];}" +
  '$tinkr_methods=[];' +
  'foreach($tinkr_reflection->getMethods(\\ReflectionMethod::IS_PUBLIC) as $tinkr_method){' +
  '$tinkr_parameters=[];' +
  'foreach($tinkr_method->getParameters() as $tinkr_parameter){' +
  "$tinkr_parameters[]=['name'=>$tinkr_parameter->getName()," +
  "'type'=>$tinkr_parameter->hasType()?(string)$tinkr_parameter->getType():null," +
  "'optional'=>$tinkr_parameter->isOptional(),'variadic'=>$tinkr_parameter->isVariadic()];}" +
  "$tinkr_methods[]=['name'=>$tinkr_method->getName(),'parameters'=>$tinkr_parameters," +
  "'return'=>$tinkr_method->hasReturnType()?(string)$tinkr_method->getReturnType():null];}" +
  "return ['class'=>$tinkr_reflection->getName(),'methods'=>$tinkr_methods];" +
  '}'

module.exports = {
  phpCompletions,
  reflectionCode,
}
