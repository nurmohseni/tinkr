const {classIndex, indexFrom, matchingFilesIn, phpString} = require('tinkr-core')

const {exec, quoted} = require('../remote')

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
 * read here. A connection over ssh is another machine's copy of the project,
 * which is the only one there is: this machine's copy, if it has one, is a
 * different checkout of another person's work, and reading it would offer
 * classes and files that have nothing to do with what is being typed.
 *
 * The other machine is asked with a command of its own — one `php -r`, the same
 * shape services/logs puts its questions in — and not through the session the
 * connection runs in. That session is the person's own prompt to tinker: the run
 * writes into it, the terminal shows it, and a question put to it is a question
 * answered while nothing else in it may happen. A project is read to answer the
 * suggestion popup, which asks on every keystroke, so a read put to the session
 * is a read paid for by the person typing: the session is busy, the popup waits
 * for another machine's filesystem, and a keystroke arriving while a read is
 * happening starts another one. A command of its own has none of that. It
 * answers while the session is used for something else, it prints nothing into
 * the terminal, it leaves no php process behind in a session that then has to be
 * waited on, and it can be started before anyone asks — so what is typed is
 * answered out of what has already been read, and never out of a walk of the
 * project that the typing set in motion (see prefetchIndex, readyIndex).
 */

// how many names one answer may carry: an optimized autoloader writes thousands,
// and an answer nobody will read in full is not one to keep in memory in full
const maxClasses = 20000

// how many paths: the popup offers forty and a prompt attaches three, so a
// project of any size has answered long before this
const maxPaths = 2000

// what one answer may be before it is not an answer this can read: the paths of
// a large project are megabytes, and a project larger than this is one whose
// index is not worth the reading
const maxAnswer = 8 * 1024 * 1024

// the directory of the project's packages, as the paths of another machine's
// project spell it: they are relative to the project, where this machine's are
// absolute
const vendor = 'vendor'

// the same eight files the local list offers, which is what the popup is sized
// for
const suggestions = 8

/**
 * The php that asks a machine what its project declares.
 *
 * It is a program rather than a form value: `php -r` runs it in the project's
 * own directory and it prints its own answer, where a form value had a session
 * to return into. It lists paths and reads composer's own files; it derives no
 * names, because naming is the one rule both machines read a project with (see
 * classIndex, and `indexFrom` in particular) and a second copy of it here would
 * be two answers for the same class. The project is the directory the command
 * runs in — `exec` puts it there — and everything it answers is relative to
 * that, which is the one spelling of a path both machines can agree on.
 *
 * What composer wrote is included rather than parsed, so the answer is the map
 * php itself would autoload with. A psr-4 directory outside the project is left
 * out: the project is what a snippet is written in, and a package's files are
 * named by the classmap.
 *
 * A project that declares nothing answers `null`, which is an answer and not a
 * silence: there is nothing to read again, where a machine that could not be
 * asked has said nothing at all. Nothing of php's own talking goes into the
 * answer — a notice written into json is json no one can read.
 *
 * @return {String} the php to run
 */
const indexCode = () => 'error_reporting(0);' +
  '$tinkr_root=getcwd();' +
  "$tinkr_composer=$tinkr_root.'/vendor/composer/';" +
  "if(!is_file($tinkr_composer.'autoload_psr4.php')){echo 'null';exit(0);}" +
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
  // the directory a psr-4 prefix names is written relative to the file it comes
  // from, so it reads `vendor/composer/../../app` — a project's own directory.
  // It is resolved before anything decides what is under `vendor/`, or a
  // project's every file would be read as one under it and dropped
  "$tinkr_path=realpath($tinkr_root.'/'.$tinkr_dir);" +
  'if($tinkr_path===false||!is_dir($tinkr_path)||!is_readable($tinkr_path)){continue;}' +
  "if(strpos(str_replace('\\\\','/',$tinkr_path),str_replace('\\\\','/',$tinkr_root).'/vendor/')===0){continue;}" +
  'try{' +
  'foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator(' +
  '$tinkr_path,FilesystemIterator::SKIP_DOTS)) as $tinkr_file){' +
  `if(count($tinkr_files)>=${maxPaths}){break 3;}` +
  // a link can point anywhere, and a `.php` name is not a promise about what is
  // behind it: a link to /etc/passwd offered as a class would let an `@` mention
  // send that file's contents to the AI provider. What resolves inside the
  // project is a file of the project; what resolves outside it is not one, and
  // is left out — the local walk skips links for the same reason
  "if(!$tinkr_file->isFile()||$tinkr_file->getExtension()!=='php'){continue;}" +
  'if($tinkr_file->isLink()){$tinkr_real=realpath($tinkr_file->getPathname());' +
  "if($tinkr_real===false||strpos(str_replace('\\\\','/',$tinkr_real),str_replace('\\\\','/',$tinkr_root).'/')!==0){continue;}}" +
  "$tinkr_relative=substr(str_replace('\\\\','/',$tinkr_file->getPathname()),strlen(str_replace('\\\\','/',$tinkr_root))+1);" +
  '$tinkr_files[]=$tinkr_relative;}' +
  '}catch(\\Throwable $tinkr_unreadable){}}}' +
  "echo json_encode(['classmap'=>$tinkr_classmap,'psr4'=>$tinkr_psr4,'files'=>$tinkr_files]);"

/**
 * Ask the machine a connection runs on a question in php, and answer with what
 * it printed.
 *
 * A host that runs a snippet is a host with php, which is the one thing the two
 * machines are known to have in common, and php reads no configuration to be
 * asked: one `php -r` per question, run in the project's own directory, is the
 * whole of it (see remote.exec). What comes back is the answer itself, and
 * nothing at all when the machine did not answer — an exit that is not zero, a
 * silence, an answer too large to keep — because a machine that does not answer
 * is not one holding an empty answer.
 *
 * @param {Record<String, any>} connection
 * @param {String} code the php to run
 * @return {Promise<String|null>}
 */
const ask = async (connection, code) => {
  const answer = await exec(connection, `php -r ${quoted(code)}`, {maxBuffer: maxAnswer})

  return answer.code === 0 ? answer.stdout : null
}

/**
 * The project of a connection over ssh, as the machine that holds it reads it.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<Object|null>} what an index of a project is, or null when the
 * machine did not answer
 */
const readIndex = async connection => {
  const answer = await ask(connection, indexCode())

  // a machine that could not be asked said nothing, and there is no answer to
  // keep of it
  if (answer === null) {
    return null
  }

  let declared

  try {
    declared = JSON.parse(answer)
  } catch (e) {
    // an answer that is not the project's own is not an answer: a machine that
    // cannot read its own project is one to ask again
    return null
  }

  if (declared !== null && (typeof declared !== 'object' || Array.isArray(declared))) {
    return null
  }

  // a project without composer's files declares nothing, and an empty index is
  // what the popup and a prompt both read such a project as
  if (declared === null) {
    return indexFrom({vendor})
  }

  return indexFrom({
    classmap: declared.classmap,
    psr4: declared.psr4,
    files: declared.files,
    vendor,
  })
}

/**
 * The project of a connection over ssh as it was last read, per connection.
 *
 * A read is kept for as long as the window runs on the connection, the way the
 * local index is kept per project, and what replaces it is the next read: the
 * one a session's creation prefetches where nothing has been read yet (see
 * prefetchIndex), and the one a finished run starts, which is what notices the
 * files that run changed on disk (see refreshIndex). Nothing is kept of a
 * machine that did not answer, so the next session asks it again rather than
 * answering out of a silence.
 *
 * @type {Map<String, Object>}
 */
const remoteIndexes = new Map()

/**
 * The reads of a connection's project that are happening now, per connection.
 *
 * @type {Map<String, Promise<Object|null>>}
 */
const remoteWalks = new Map()

/**
 * Read a connection's project over ssh, once at a time.
 *
 * A read is the read of every caller: what is in flight is what is handed back,
 * so ten questions about a project that has not been read yet are one walk of
 * another machine and not ten. What answers is kept; a read that could not
 * answer is not, so the next caller — a prompt, which can wait — asks again
 * rather than being answered out of a machine's silence.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<Object|null>} never rejects: a read that failed is an empty
 * index
 */
const walkIndex = connection => {
  const walking = remoteWalks.get(connection.id)

  if (walking) {
    return walking
  }

  const started = readIndex(connection).then(index => {
    // the read this one replaces may have been forgotten while it ran — the
    // tests forget them between cases — and an answer nobody is waiting on any
    // more is not one to keep
    if (remoteWalks.get(connection.id) === started) {
      remoteWalks.delete(connection.id)

      if (index) {
        remoteIndexes.set(connection.id, index)
      }
    }

    return index
  }, () => {
    if (remoteWalks.get(connection.id) === started) {
      remoteWalks.delete(connection.id)
    }

    return null
  })

  remoteWalks.set(connection.id, started)

  return started
}

/**
 * The index of a connection's project, for whoever can wait for it to be read.
 *
 * A prompt's attachments are asked for when the request is sent, and a request
 * is not a keystroke: it waits for a project that has not been read yet, and is
 * handed the read that is already happening if there is one. The popup does not
 * come here (see readyIndex): nothing it has to say is worth a keystroke waiting
 * on another machine's filesystem.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<Object|null>} what an index of a project is, or null when the
 * project has nothing to offer, or when the machine that holds it did not answer
 */
const indexFor = async connection => {
  if (!connection) {
    return null
  }

  // a local project is this machine's, and its index is kept once read
  if (!connection.is_over_ssh) {
    return classIndex(connection.path)
  }

  return remoteIndexes.get(connection.id) || walkIndex(connection)
}

/**
 * The index of a connection's project, as far as it has been read.
 *
 * This is the popup's question, and the popup's question arrives with a
 * keystroke: a project over ssh is another machine's filesystem, and a keystroke
 * neither waits for it nor sets it in motion. What has been read answers — it is
 * read where a session comes up, before anyone has typed — and what has not is
 * an empty popup, with the read still on its way for the keystroke after this
 * one.
 *
 * @param {Record<String, any>} connection
 * @return {Object|null} what an index of a project is, or null for nothing to
 * suggest yet
 */
const readyIndex = connection => {
  if (!connection) {
    return null
  }

  if (!connection.is_over_ssh) {
    return classIndex(connection.path)
  }

  return remoteIndexes.get(connection.id) || null
}

/**
 * Read a connection's project, where a session comes up and nothing is waiting
 * on it yet.
 *
 * A read is started where it can be afforded rather than where it is waited on:
 * a session comes up where a connection is opened — and where a run has left one
 * behind — so that the person typing is never the reason another machine is
 * walked. What has been read already is not read again: that answer was read at
 * the session before this one and refreshed by every run since (see
 * refreshIndex), and booting the session a run left behind is no reason to walk
 * the project a second time. A project the machine could not describe is not one
 * of those — nothing was kept of it — so the session after a failed read is what
 * asks the machine again.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<Object|null>|undefined} the read, for whoever wants to wait
 * for it
 */
const prefetchIndex = connection => {
  // this machine's projects are read here, in the moment they are asked about
  if (!connection || !connection.is_over_ssh) {
    return undefined
  }

  if (remoteIndexes.has(connection.id)) {
    return undefined
  }

  return walkIndex(connection)
}

/**
 * Read a connection's project again, for the moment a run has finished.
 *
 * A run is the one thing in this app that changes a project: a snippet that
 * writes a file, or dumps a composer autoloader, has changed what the project
 * declares by the time its value comes back — which is when this is called (see
 * createPty) — so what is offered next is read after the run rather than beside
 * it, out of the project the run left behind. It is the same read as any other,
 * so it replaces what the connection had and is never one of two.
 *
 * @param {Record<String, any>} connection
 * @return {Promise<Object|null>|undefined} the read, for whoever wants to wait
 * for it
 */
const refreshIndex = connection => {
  if (!connection || !connection.is_over_ssh) {
    return undefined
  }

  return walkIndex(connection)
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
 * The read is asked over a command of its own, for the same reason a walk is:
 * a prompt's attachment is not worth the session the person works in. The read
 * is capped at one byte more than a prompt carries, so a large file costs a
 * large file's answer: what comes back is cut to what is sent either way.
 *
 * @param {Record<String, any>} connection
 * @param {String} file the path, as the project spells it
 * @return {Promise<String|null>} null when the machine cannot read the file
 */
const remoteCode = async (connection, file) => {
  const answer = await ask(
    connection,
    'error_reporting(0);' +
    '$tinkr_code=@file_get_contents(' + phpString(file) + ',false,null,0,' + (maxFile + 1) + ');' +
    'if($tinkr_code===false){exit(1);}' +
    'echo base64_encode($tinkr_code);',
  )

  // a file that went away between the index and the read is one to leave out,
  // the same way a file this machine cannot open is
  return answer === null ? null : Buffer.from(answer, 'base64').toString('utf8')
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
 * Forget what has been read of the connections over ssh, and the reads of them
 * that are happening; the tests read a project per case.
 */
const clearRemoteIndexes = () => {
  remoteIndexes.clear()
  remoteWalks.clear()
}

module.exports = {
  indexCode,
  indexFor,
  readyIndex,
  prefetchIndex,
  refreshIndex,
  filesFor,
  attachmentsFor,
  clearRemoteIndexes,
}
