const {phpString} = require('./runResult')

/**
 * A project that lives in a container, as the command that reaches it.
 *
 * A container is not a way for the app to connect: the project's files are on
 * this machine, mounted into the container, and the php that runs the code is
 * inside it. So a container connection is a local one — the path is the host's
 * directory, and the index and the logs read it as the host — whose command is
 * the container's own, `docker exec … php artisan tinker`.
 *
 * That is what the app asks for when the type is chosen: the engine, the
 * container (or pod, or unit) and the command the app runs inside it, from
 * which the whole command is built. The fields are kept on the connection as
 * well, so the form opens on what was chosen rather than on a command parsed
 * back out of a string.
 *
 * @typedef {Object} ContainerConnection
 * @property {String} container_engine `docker`, `podman`, `sail` or `kubectl`
 * @property {String} container_name the container, pod, or sail service
 * @property {String} container_command what runs inside it, `php artisan tinker`
 *   by default
 */

/**
 * The engines the app can build a command for, and how each one reaches a
 * process inside what it runs.
 *
 * `-it` is what a tinker session needs: a terminal, and stdin held open, or
 * psysh reads end-of-file on its first prompt and the session closes before the
 * run is written into it. `kubectl` spells the same thing `-it` too, and a pod
 * with several containers needs `-c`.
 *
 * @type {Object<String, {exec: Function}>}
 */
const engines = {
  // `-w` is where the command runs inside the container, and it is the engine's
  // own flag: artisan's `--working-dir` is a different thing, and putting it
  // after the command would hand it to the program the container runs
  docker: {
    exec: ({name, command, dir}) => `docker exec -it${dir ? ` -w ${dir}` : ''} ${name} ${command}`,
  },
  podman: {
    exec: ({name, command, dir}) => `podman exec -it${dir ? ` -w ${dir}` : ''} ${name} ${command}`,
  },
  // sail is laravel's wrapper around docker compose: the "container" is the
  // service name, and the compose file already says where the project is mounted
  sail: {
    exec: ({name, command}) => `./vendor/bin/sail ${name} ${command}`,
  },
  // kubectl has no working-directory flag: the container's own default is used
  kubectl: {
    exec: ({name, command}) => `kubectl exec -it ${name} -- ${command}`,
  },
}

/**
 * The same engines, for a question rather than a session.
 *
 * A read is not a session: it prints one answer and exits, and `-t` would make
 * the engine ask for a terminal that a pipe does not have. `-i` is all a read
 * needs, and `--rm` is not wanted either — the container is already running, and
 * this only reaches into it.
 *
 * @type {Object<String, {read: Function}>}
 */
const reads = {
  docker: ({name, command}) => `docker exec -i ${name} ${command}`,
  podman: ({name, command}) => `podman exec -i ${name} ${command}`,
  // sail runs its command through compose, which has no terminal to allocate
  // here either
  sail: ({name, command}) => `./vendor/bin/sail ${name} ${command}`,
  kubectl: ({name, command}) => `kubectl exec -i ${name} -- ${command}`,
}

/**
 * How each engine lists what it is running.
 *
 * This is what a form offers instead of a name to type: a container created by a
 * compose file or a PaaS is named per deploy (`app-abc123`), so a name stored in
 * a connection is stale after the next one. The list is of what is running now,
 * which is what a session has to reach.
 *
 * Each answers one container a line — the name, a tab, the image — because the
 * two together are what tells one container from another when every name is a
 * hash. Sail is docker compose, so its containers are docker's and are listed as
 * such. A pod is the unit kubectl reaches, and its first container's image is
 * enough to say what it runs.
 *
 * @type {Object<String, {list: String}>}
 */
const lists = {
  docker: () => `docker ps --format ${word('{{.Names}}\t{{.Image}}')}`,
  podman: () => `podman ps --format ${word('{{.Names}}\t{{.Image}}')}`,
  sail: () => `docker ps --format ${word('{{.Names}}\t{{.Image}}')}`,
  kubectl: () => `kubectl get pods --no-headers -o custom-columns=${word('NAME:.metadata.name,IMAGE:.spec.containers[0].image')}`,
}

/**
 * The container engines the app offers.
 *
 * @type {Array<String>}
 */
const engineNames = Object.keys(engines)

/**
 * A name as one word of a shell reads it.
 *
 * The command the session types is a shell line, so a container name with a
 * space in it would be two words to the shell that runs it. What is written
 * whole stays whole; what needs quoting is quoted.
 *
 * @param {String} value
 * @return {String}
 */
const word = value => (/^[A-Za-z0-9@%+=:,._/-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`)

/**
 * Whether a connection's project is inside a container.
 *
 * The two kinds are not exclusive. A project deployed by a compose file on a
 * server is a container on that server: the session has to reach the machine
 * over ssh *and* reach into the container once it is there. What makes it a
 * container connection is the container it names, wherever the engine that runs
 * it happens to be.
 *
 * @param {Record<String, any>} connection
 * @return {Boolean}
 */
const inContainer = connection => Boolean(connection && String(connection.container_engine || '').trim())

/**
 * The command a container connection runs, or '' when it names no container.
 *
 * Nothing is guessed about a name that is not there: a container connection with
 * no container is not a connection, and the form says so by leaving the command
 * empty rather than building `docker exec -it  php artisan tinker`.
 *
 * The command does not change when the project is on another machine. Every
 * engine here reaches its own daemon: `docker` and `podman` talk to the daemon
 * on the machine they run on, `sail` is the project's own `./vendor/bin/sail`
 * and runs in its directory, and `kubectl` is a client reached from wherever it
 * is configured. What the ssh line does is put the command on the far side of
 * the connection — after a `cd` into the project — so the same words mean the
 * same thing there as here. Only the reads that index the project and tail its
 * logs have to change, and they change in services/project and services/logs.
 *
 * @param {ContainerConnection} connection
 * @return {String}
 */
const containerCommand = (connection = {}) => {
  const {container_engine: engine, container_name: name, container_command: command} = connection
  const chosen = engines[engine]
  const container = String(name || '').trim()

  if (!chosen || !container) {
    return ''
  }

  const inside = String(command || '').trim() || 'php artisan tinker'

  // the command runs where the container's project is, not where the session
  // happens to be: a local session starts in the project on this machine, and
  // one over ssh starts in the account's home, because a containerized deploy
  // need not hold the project on the machine at all
  const dir = containerPath(connection)

  return chosen.exec({name: word(container), command: inside, dir: dir ? word(dir) : null})
}

/**
 * A command run inside the connection's container, for a question that has to
 * reach the project's files.
 *
 * The files of a project in a container may be nowhere on the machine that runs
 * the container — a compose file can keep them in a volume, and a deployed image
 * can hold them only inside itself. So the reads that index the project and tail
 * its logs cannot use the machine's own `php`: they run the same `php -r` inside
 * the container, where the project is.
 *
 * @param {Record<String, any>} connection
 * @param {String} command what to run inside it
 * @return {String} the command, or '' when the connection names no container
 */
const containerRead = (connection, command) => {
  const engine = connection && connection.container_engine
  const container = String((connection && connection.container_name) || '').trim()
  const chosen = reads[engine]

  if (!chosen || !container) {
    return ''
  }

  // the project's directory is the one inside the container, which is not the
  // machine's path: a compose file can mount it anywhere, and a deployed image
  // can hold it at its own. So the `cd` goes inside the same command as the
  // question, and the two are handed to a shell there as one word
  const project = containerPath(connection)
  const inside = project
    ? `sh -c ${whole(`cd ${word(project)} && ${command}`)}`
    : command

  return chosen({name: word(container), command: inside})
}

/**
 * A string as one word of a shell, always quoted.
 *
 * `word` leaves a plain word alone, which is right for a value and wrong for a
 * command: an unquoted command is several words to the shell that is handed it.
 * What is handed over as one argument is quoted as one, whatever it holds.
 *
 * @param {String} value
 * @return {String}
 */
const whole = value => `'${String(value).replace(/'/g, "'\\''")}'`

/**
 * Where the project is inside its container.
 *
 * `path` is where the machine holds the project — the directory a session over
 * ssh cd's into, and a local one's. A container sees it somewhere of its own:
 * compose mounts it where the image expects, and a deployed image holds it at
 * its own path. `container_path` says so, and otherwise the two are the same,
 * which is what a project mounted in at its host path does.
 *
 * @param {Record<String, any>} connection
 * @return {String}
 */
const containerPath = connection => String(
  (connection && (connection.container_path || connection.path)) || '',
).trim()

/**
 * How deep a search for a project inside a container goes.
 *
 * A deployed project sits a few levels down at most — `/var/www/html`,
 * `/app`, `/srv/app`, `/usr/src/app` — and a container's whole filesystem is not
 * something to walk. Four levels reaches the usual ones and stops.
 */
const projectDepth = 4

/**
 * The command that lists the directories inside a container that look like a
 * project, as one php prints them.
 *
 * The test is the two files a php project is recognized by: `composer.json`,
 * which says what it depends on, and `artisan`, which says it is Laravel. Either
 * is a project, and a directory with neither is not offered — a picker full of
 * every directory in the container is not a picker.
 *
 * `find` is not used: it is not in every image (a scratch or a distroless one has
 * none), and php is, because a container this connection runs php in has it by
 * definition.
 *
 * @param {String} root where to start looking
 * @return {String}
 */
const projectDirsCommand = (root = '/') => `php -r ${word(
  '$tinkr_root = ' + phpString(root) + ';' +
  `$tinkr_depth = ${projectDepth};` +
  '$tinkr_found = [];' +
  '$tinkr_walk = function ($dir, $depth) use (&$tinkr_walk, &$tinkr_found, $tinkr_depth) {' +
  'if ($depth > $tinkr_depth) { return; }' +
  "$tinkr_has = @is_file($dir . '/composer.json') || @is_file($dir . '/artisan');" +
  'if ($tinkr_has) { $tinkr_found[] = $dir; }' +
  '$tinkr_entries = @scandir($dir);' +
  'if ($tinkr_entries === false) { return; }' +
  'foreach ($tinkr_entries as $tinkr_entry) {' +
  "if ($tinkr_entry === '.' || $tinkr_entry === '..') { continue; }" +
  // the root is "/" or a directory, and joining the two by hand would make
  // "//work" out of "/" and "work": the separator belongs only when the
  // directory does not already end with one
  '$tinkr_path = rtrim($dir, "/") . "/" . $tinkr_entry;' +
  // a link can point anywhere, and a project found through one is not one of
  // this container's: what is walked is what is really here
  'if (@is_link($tinkr_path)) { continue; }' +
  'if (@is_dir($tinkr_path)) { $tinkr_walk($tinkr_path, $depth + 1); }' +
  '}' +
  '};' +
  '$tinkr_walk($tinkr_root === "" ? "/" : $tinkr_root, 0);' +
  'echo implode("\n", $tinkr_found);',
)}`

/**
 * The command that lists what an engine is running, or '' for one that cannot.
 *
 * @param {String} engine
 * @return {String}
 */
const containerList = engine => (lists[engine] ? lists[engine]() : '')

/**
 * What a listing answered, as the containers a form offers.
 *
 * The formats differ — docker and podman answer `name<TAB>image`, kubectl answers
 * columns separated by whitespace — so what is read here is the one thing they
 * agree on: the first word is the container, and the rest is what it runs. A line
 * with no name is not a container, and an engine that answered nothing is a
 * machine with nothing running rather than one to fail on.
 *
 * @param {String} answer what the listing printed
 * @return {Array<{name: String, image: String}>}
 */
const containersIn = answer => String(answer || '')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line !== '')
  .map(line => {
    const [name, ...rest] = line.split(/\s+/)

    return {name, image: rest.join(' ')}
  })
  // a list has a header on some engines, and a header is not a container: a name
  // is what an exec can be given, and `NAME` is not one
  .filter(({name}) => name && name !== 'NAME')

/**
 * The directories a project inside a container could be, as the directories that
 * look like one.
 *
 * A deployed project is somewhere under the container's own files, and asking
 * someone to type its path is asking for a guess. What is offered here is what
 * can be recognized without knowing the project: a directory with a `composer.json`
 * or an `artisan` in it, which is a php project, plus the directory the engine
 * starts in. The depth is bounded, because a container's whole filesystem is not
 * a picker.
 *
 * @param {String} answer what the find printed
 * @return {Array<String>}
 */
const projectDirsIn = answer => String(answer || '')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line !== '')
  .filter((line, at, all) => all.indexOf(line) === at)
  .sort()

/**
 * The command a session runs, given what the connection is.
 *
 * A container's command is the connection's: it is what runs the php, and the
 * session's job is only to be in the right place to run it. A connection that
 * names no container is its own command, as it always was.
 *
 * @param {Record<String, any>} connection
 * @return {String}
 */
const sessionCommand = connection => {
  if (!connection) {
    return ''
  }

  if (inContainer(connection)) {
    return containerCommand(connection) || ''
  }

  return connection.command || ''
}

/**
 * What kind of connection this is, for everything that only needs to know that.
 *
 * The app stores the kind rather than deriving it every time: a connection saved
 * before there were containers is a local one or an ssh one, and `is_over_ssh`
 * is what it always was. A connection can be both — a container on a server is
 * one — and `container` is the kind that says where the php runs: the project is
 * in a container, whichever machine the container is on.
 *
 * @param {Record<String, any>} connection
 * @return {String} `local`, `ssh`, `container` or `ssh-container`
 */
const connectionKind = connection => {
  const container = inContainer(connection)
  const ssh = Boolean(connection && connection.is_over_ssh)

  if (container && ssh) {
    return 'ssh-container'
  }

  if (container) {
    return 'container'
  }

  if (ssh) {
    return 'ssh'
  }

  return 'local'
}

module.exports = {
  engines,
  engineNames,
  containerCommand,
  containerList,
  containersIn,
  projectDirsCommand,
  projectDirsIn,
  containerRead,
  containerPath,
  sessionCommand,
  inContainer,
  connectionKind,
  word,
}
