/**
 * A project that lives in a container, as the command that reaches it.
 *
 * A container connection is a local one — the files are on this machine, mounted
 * in, and the php that runs the code is inside — whose command is the
 * container's own. The form's three fields are what the connection stores; this
 * is what turns them into the command a session starts with, and the command is
 * stored with the connection: what is built here is what the main process later
 * types into a shell.
 *
 * The same function is in tinkr-core for the main process, and the two are the
 * same on purpose: a test asserts they agree for every engine, for both
 * platforms, and for names that need quoting, because a form that builds one
 * command and a run that reads another is a connection that does nothing.
 *
 * The renderer cannot import core's copy: the bundle has no node and no
 * `process`, and core's module graph reaches `node-pty`. So the one rule that
 * differs by platform — how a word is quoted — is mirrored here, and the test
 * that compares the two is what keeps them from drifting. `platform` is read
 * from the bridge the preload installs (`api.platform`); everything else about
 * the line is the same on every machine.
 *
 * `-it` is what a tinker session needs: a terminal, and stdin held open, or
 * psysh reads end-of-file on its first prompt and closes before the run is
 * written into it.
 */

const ENGINES = ['docker', 'podman', 'sail', 'kubectl']

// what cmd reads as more than part of a word, and what a word may hold without
// being quoted: the caret is the escape character, `&` `|` `<` `>` `(` `)`
// separate and redirect and group, `"` is the only quote cmd has, `%` and `!`
// are expanded before the word is looked at, and a space is the separator
// everything else is measured against. `,` `;` and `=` are delimiters of cmd's
// own. (the same set as tinkr-core's shell.js)
const CMD_SAFE_WORD = /^[A-Za-z0-9@._/:-]+$/

// a posix shell does not interpret anything inside single quotes, and the one
// character they cannot hold is the quote itself, which is written as a close,
// an escaped quote and a reopen. (the same rule as tinkr-core's shell.js)
const POSIX_SAFE_WORD = /^[A-Za-z0-9@%+=:,._/-]+$/

/**
 * A value as one word of cmd.exe.
 *
 * The word is wrapped in double quotes, which is what makes the separators and
 * the caret ordinary characters; a quote inside it is doubled, so the receiving
 * program's own command-line parser reads it back as one and the number of
 * quotes cmd sees stays even; a run of backslashes at the end is doubled, or the
 * parser would read one as escaping the closing quote. `%` and `!` are escaped
 * last because cmd expands them before it looks at quotes.
 *
 * @param {String} value
 * @return {String}
 */
const cmdQuote = value => {
  const doubled = value.replace(/"/g, '""')
  const tail = /\\+$/.test(doubled) ? '\\' : ''

  return `"${`${doubled}${tail}`.replace(/[%!]/g, '^$&')}"`
}

/**
 * A value as one word of a shell, quoted only when it has to be.
 *
 * @param {String} value
 * @param {String} platform the shell that will read the line
 * @return {String}
 */
const word = (value, platform) => {
  const text = String(value)

  if (platform === 'win32') {
    return CMD_SAFE_WORD.test(text) ? text : cmdQuote(text)
  }

  return POSIX_SAFE_WORD.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`
}

/**
 * The platform whose shell reads the command this form builds.
 *
 * The preload exposes the machine's platform, because the renderer has no
 * `process` of its own. Anything else — a page opened outside the app, a test
 * with no bridge — is read as a posix machine, which is what every host this
 * app reached before there was a windows one.
 *
 * @return {String}
 */
export const appPlatform = () => {
  const platform = typeof window !== 'undefined' && window.api && window.api.platform

  return typeof platform === 'string' && platform !== '' ? platform : 'posix'
}

/**
 * A value as one word of a shell, quoted whatever it holds.
 *
 * For a command rather than a name: a command handed to `sh -c` is one word of
 * the shell that reads the line, and an unquoted one is several. (the same rule
 * as tinkr-core's shell.shellQuote)
 *
 * @param {String} value
 * @param {String} platform the shell that will read the line
 * @return {String}
 */
const whole = (value, platform) => (platform === 'win32'
  ? cmdQuote(String(value))
  : `'${String(value).replace(/'/g, "'\\''")}'`)

/**
 * What each of a kubectl connection's fields is a flag of the command.
 *
 * The fields are kept on the connection under names that say what they are, and
 * kubectl takes them by letter or by a long option: what differs between the two
 * is the flag, not the value. (the same table as tinkr-core's)
 *
 * @type {Object<String, String>}
 */
const KUBE_FLAGS = {
  kube_config: '--kubeconfig',
  kube_context: '--context',
  kube_namespace: '-n',
  kube_container: '-c',
}

/**
 * The flags that name which cluster, namespace and container a kubectl command is
 * about, as words of the shell that reads it.
 *
 * `--kubeconfig` and `--context` come before the verb, `-n` and `-c` after it,
 * and a field left empty is a flag left out: a connection that names none builds
 * exactly the line it built before the fields existed.
 *
 * @param {Record<String, any>} connection
 * @param {String} shell the shell that will read the line
 * @return {{cluster: String, namespace: String, container: String}}
 */
const kubeSelection = (connection, shell) => {
  const flag = field => {
    const text = String((connection || {})[field] || '').trim()

    return text ? ` ${KUBE_FLAGS[field]} ${word(text, shell)}` : ''
  }

  const cluster = flag('kube_config') + flag('kube_context')

  return {
    cluster,
    namespace: flag('kube_namespace'),
    container: flag('kube_container'),
  }
}

/**
 * @param {Record<String, any>} connection with `container_engine`,
 *   `container_name`, `container_command`, and `is_over_ssh` when the project is
 *   on another machine; a kubectl one may also name `kube_config`,
 *   `kube_context`, `kube_namespace` and `kube_container`
 * @param {String} [platform] the shell that will read the command, which is this
 *   machine's unless the project is reached over ssh
 * @return {String} the command, or '' when it names no container
 */
export const containerCommand = ({
  container_engine: engine,
  container_name: name,
  container_command: command,
  path,
  container_path: inContainer,
  is_over_ssh: ssh,
  kube_config: kubeconfig,
  kube_context: context,
  kube_namespace: namespace,
  kube_container: podContainer,
} = {}, platform = appPlatform()) => {
  // the line is typed into this machine's shell but read by the far login shell
  // when the connection is over ssh, and that one is a posix shell on every host
  // this app reaches: its words are quoted there, whatever this machine is
  const shell = ssh ? 'posix' : platform
  const container = String(name || '').trim()

  if (!ENGINES.includes(engine) || !container) {
    return ''
  }

  const inside = String(command || '').trim() || 'php artisan tinker'
  const named = word(container, shell)

  // where the command runs inside the container. `container_path` is the
  // container's own idea of where the project is, and `path` the machine's,
  // which is the same thing for a project mounted in at its host path
  const dir = String((inContainer || path) || '').trim()
  const where = dir ? ` -w ${word(dir, shell)}` : ''
  const kube = kubeSelection({kube_config: kubeconfig, kube_context: context, kube_namespace: namespace, kube_container: podContainer}, shell)

  switch (engine) {
    case 'sail':
      // laravel's wrapper around docker compose: the container is the service,
      // and the compose file already says where the project is mounted
      return `./vendor/bin/sail ${named} ${inside}`
    case 'kubectl': {
      // kubectl has no working-directory flag, so where the command runs is a
      // `cd` inside the pod, handed to a shell there as one word (see
      // tinkr-core's containerRead for the same shape). That payload's own words
      // are posix, because every image this app reaches has a posix `sh`; the
      // word the shell is given is quoted for the shell that reads this line.
      // The machine's `path` is not the pod's — its filesystem is its image's —
      // so only `container_path` is a directory there
      const run = String(inContainer || '').trim()

      return `kubectl${kube.cluster} exec -it${kube.namespace}${kube.container} ${named} -- ${
        run ? `sh -c ${whole(`cd ${word(run, 'posix')} && ${inside}`, shell)}` : inside}`
    }
    default:
      return `${engine} exec -it${where} ${named} ${inside}`
  }
}

export const engineNames = ENGINES
