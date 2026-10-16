const {classIndex, indexFrom, matchingFilesIn, phpString} = require('tinkr-core')

const {ensureBackgroundPty} = require('../createBackgroundPty')
const {getBackgroundPtyProcess} = require('../processes')

const {
  filesFor: localFilesFor,
  attachmentsFor: localAttachmentsFor,
  mentions,
  maxFile,
  maxFiles,
  capped,
} = require('./files')

/**
 * A connection's project, as the machine the connection runs on sees it.
 *
 * A local connection is a directory of this machine, and everything about it is
 * read here. A connection over ssh is a session on another machine, whose copy
 * of the project is the only one there is: this machine's copy, if it has one,
 * is a different checkout of another person's work, and reading it would offer
 * classes and files that have nothing to do with what is being typed. So the
 * other machine is asked, through the session the connection already runs (a php
 * value resolves over ssh the same way it does here), and what comes back is
 * read with the naming rule both machines share.
 *
 * A session is not always there to answer — it comes up lazily, it goes away, it
 * can be restarted mid-question — so nothing here holds a popup open while it
 * waits, and nothing throws at the person typing.
 */

// how many names one answer may carry: an optimized autoloader writes thousands,
// and a session that has to print them all is a session that answers nothing
// else while it does
const maxClasses = 20000

// how many paths: the popup offers forty and a prompt attaches three, so a
// project of any size has answered long before this
const maxPaths = 2000

// what one answer may be before it is not an answer this can read: the paths of
// a large project are megabytes, and a project larger than this is one whose
// index is not worth the session's time
const maxAnswer = 8 * 1024 * 1024

// the directory of the project's packages, as the paths of another machine's
// project spell it: they are relative to the project, where this machine's are
// absolute
const vendor = 'vendor'

// the same eight files the local list offers, which is what the popup is sized
// for
const suggestions = 8

/**
 * The php that asks a session what its project declares.
 *
 * It lists paths and reads composer's own files; it derives no names, because
 * naming is the one rule both machines read a project with (see classIndex, and
 * `indexFrom` in particular) and a second copy of it here would be two answers
 * for the same class. The project is the directory the session is in — the
 * connection put it there — and everything it answers is relative to that, which
 * is the one spelling of a path both machines can agree on.
 *
 * What composer wrote is included rather than parsed, so the answer is the map
 * php itself would autoload with. A psr-4 directory outside the project is left
 * out: the project is what a snippet is written in, and a package's files are
 * named by the classmap.
 *
 * @return {String} the form value the session is asked to resolve
 */
const indexCode = () => 'function(){' +
  '$tinkr_root=getcwd();' +
  "$tinkr_composer=$tinkr_root.'/vendor/composer/';" +
  "if(!is_file($tinkr_composer.'autoload_psr4.php')){return null;}" +
  '$tinkr_classmap=[];' +
  "$tinkr_written=@include $tinkr_composer.'autoload_classmap.php';" +
  'if(is_array($tinkr_written)){foreach(array_keys($tinkr_written) as $tinkr_name){' +
  `if(count($tinkr_classmap)<${maxClasses}){$tinkr_classmap[]=(string)$tinkr_name;}}}` +
  '$tinkr_psr4=[];' +
  "$tinkr_written=@include $tinkr_composer.'autoload_psr4.php';" +
  'if(is_array($tinkr_written)){foreach($tinkr_written as $tinkr_prefix=>$tinkr_dirs){' +
  '$tinkr_relative=[];' +
  'foreach((array)$tinkr_dirs as $tinkr_dir){' +
  "$tinkr_dir=str_replace('\\\\','/',(string)$tinkr_dir);" +
  "if(strpos($tinkr_dir,$tinkr_root.'/')!==0){continue;}" +
  '$tinkr_relative[]=substr($tinkr_dir,strlen($tinkr_root)+1);}' +
  'if($tinkr_relative){$tinkr_psr4[$tinkr_prefix]=$tinkr_relative;}}}' +
  '$tinkr_files=[];' +
  'foreach($tinkr_psr4 as $tinkr_dirs){foreach($tinkr_dirs as $tinkr_dir){' +
  "if(strpos($tinkr_dir,'vendor/')===0){continue;}" +
  "$tinkr_path=$tinkr_root.'/'.$tinkr_dir;" +
  'if(!is_dir($tinkr_path)||!is_readable($tinkr_path)){continue;}' +
  'try{' +
  'foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator(' +
  '$tinkr_path,FilesystemIterator::SKIP_DOTS)) as $tinkr_file){' +
  `if(count($tinkr_files)>=${maxPaths}){break 3;}` +
  "if(!$tinkr_file->isFile()||$tinkr_file->getExtension()!=='php'){continue;}" +
  "$tinkr_relative=substr(str_replace('\\\\','/',$tinkr_file->getPathname()),strlen($tinkr_root)+1);" +
  "if(strpos($tinkr_relative,'vendor/')===0){continue;}" +
  '$tinkr_files[]=$tinkr_relative;}' +
  '}catch(\\Throwable $tinkr_unreadable){}}}' +
  "return ['classmap'=>$tinkr_classmap,'psr4'=>$tinkr_psr4,'files'=>$tinkr_files];" +
  '}'

/**
 * What the index of a connection over ssh was, and the session it was read from.
 *
 * The index of a project is a read of the project, and a run replaces the
 * session: anything that ran after the last read can have added a class to the
 * project, so an entry is only read back while the session it was read from is
 * still the one the connection runs. Comparing the session by reference is what
 * makes that observable without listening for a run to start.
 *
 * @type {Map<String, {pty: Object, index: Object}>}
 */
const remoteIndexes = new Map()

/**
 * The session's answer, as an index.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<{index: Map<String, Set<String>>, own: Array<String>,
 *   files: Array<Object>}|null>} null when the session did not answer
 */
const remoteIndex = async connection => {
  const cached = remoteIndexes.get(connection.id)

  if (cached && getBackgroundPtyProcess(connection.id) === cached.pty) {
    return cached.index
  }

  // the session is booted on demand, so the machine that is answering is one the
  // connection has already opened
  ensureBackgroundPty(connection.id)

  const pty = getBackgroundPtyProcess(connection.id)

  if (!pty) {
    return null
  }

  let answer

  try {
    answer = await pty.jsonResult(indexCode())
  } catch (e) {
    // the session went away, it never came up, or it is a machine that cannot
    // read its own project: there is nothing to offer, and nothing to say
    return null
  }

  if (typeof answer !== 'string' || answer.length > maxAnswer) {
    return null
  }

  let declared

  try {
    declared = JSON.parse(answer)
  } catch (e) {
    return null
  }

  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    return null
  }

  const index = indexFrom({
    classmap: declared.classmap,
    psr4: declared.psr4,
    files: declared.files,
    vendor,
  })

  remoteIndexes.set(connection.id, {pty, index})

  return index
}

/**
 * The classes of a connection's project, for the name being typed.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<{index: Map<String, Set<String>>, own: Array<String>,
 *   files: Array<Object>}|null>} null when the project has nothing to offer, or
 * when the machine that holds it did not answer
 */
const indexFor = connection => {
  if (!connection) {
    return Promise.resolve(null)
  }

  // a local project is this machine's, and its index is kept once read
  return connection.is_over_ssh ? remoteIndex(connection) : Promise.resolve(classIndex(connection.path))
}

/**
 * The files an `@` in an AI prompt can name.
 *
 * A path over ssh is the project's own spelling of it, which is what the local
 * list answers with too: nothing a person reads should be a path of this
 * machine's.
 *
 * @param {Record<String, any>} connection
 * @param {String} typed what is being typed after the `@`
 * @return {Promise<Array<{name: String, qualified: String, path: String}>>}
 */
const filesFor = async (connection, typed) => {
  if (!connection) {
    return []
  }

  if (!connection.is_over_ssh) {
    return localFilesFor(connection.path, typed)
  }

  return matchingFilesIn(await indexFor(connection), typed, suggestions).map(({name, qualified, file}) => ({
    name,
    qualified,
    path: file,
  }))
}

/**
 * A file of another machine's project, as that machine reads it.
 *
 * The read is capped at one byte more than a prompt carries, so a large file
 * costs a large file's answer: what comes back is cut to what is sent either
 * way.
 *
 * @param {Record<String, any>} connection
 * @param {String} file the path, as the project spells it
 * @return {Promise<String|null>} null when the session cannot read the file
 */
const remoteCode = async (connection, file) => {
  ensureBackgroundPty(connection.id)

  const pty = getBackgroundPtyProcess(connection.id)

  if (!pty) {
    return null
  }

  const code = 'function(){' +
    `$tinkr_code=@file_get_contents(${phpString(file)},false,null,0,${maxFile + 1});` +
    'return $tinkr_code===false?null:base64_encode($tinkr_code);' +
    '}'

  try {
    const answer = JSON.parse(await pty.jsonResult(code))

    // a file that went away between the index and the read is one to leave out,
    // the same way a file this machine cannot open is
    return typeof answer === 'string' ? Buffer.from(answer, 'base64').toString('utf8') : null
  } catch (e) {
    return null
  }
}

/**
 * The files a prompt names, read, for the request to carry.
 *
 * @param {Record<String, any>} connection
 * @param {String} prompt
 * @return {Promise<Array<{name: String, qualified: String, path: String,
 *   code: String}>>}
 */
const attachmentsFor = async (connection, prompt) => {
  if (!connection) {
    return []
  }

  if (!connection.is_over_ssh) {
    return localAttachmentsFor(connection.path, prompt)
  }

  const found = await indexFor(connection)

  if (!found) {
    return []
  }

  const named = mentions(prompt)
    .map(name => found.files.find(one => one.qualified === name || one.name === name))
    .filter(Boolean)
    .slice(0, maxFiles)

  const attachments = []

  for (const {name, qualified, file} of named) {
    const code = await remoteCode(connection, file)

    if (code !== null) {
      attachments.push({name, qualified, path: file, code: capped(code)})
    }
  }

  return attachments
}

/**
 * Forget what has been indexed of the connections over ssh; the tests open a
 * session per case.
 */
const clearRemoteIndexes = () => {
  remoteIndexes.clear()
}

module.exports = {
  indexCode,
  indexFor,
  filesFor,
  attachmentsFor,
  clearRemoteIndexes,
}
