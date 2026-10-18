/**
 * A project that lives in a container, as the command that reaches it.
 *
 * A container connection is a local one — the files are on this machine, mounted
 * in, and the php that runs the code is inside — whose command is the
 * container's own. The form's three fields are what the connection stores; this
 * is what turns them into the command a session starts with.
 *
 * The same function is in tinkr-core for the main process, and the two are the
 * same on purpose: a test asserts they agree, because a form that builds one
 * command and a run that reads another is a connection that does nothing.
 *
 * `-it` is what a tinker session needs: a terminal, and stdin held open, or
 * psysh reads end-of-file on its first prompt and closes before the run is
 * written into it.
 */

const ENGINES = ['docker', 'podman', 'sail', 'kubectl']

// a name as one word of the shell the session types into
const word = value => (/^[A-Za-z0-9@%+=:,._/-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`)

/**
 * @param {Record<String, any>} connection with `container_engine`,
 *   `container_name` and `container_command`
 * @return {String} the command, or '' when it names no container
 */
export const containerCommand = ({container_engine: engine, container_name: name, container_command: command} = {}) => {
  const container = String(name || '').trim()

  if (!ENGINES.includes(engine) || !container) {
    return ''
  }

  const inside = String(command || '').trim() || 'php artisan tinker'
  const named = word(container)

  switch (engine) {
    case 'sail':
      // laravel's wrapper around docker compose: the container is the service
      return `./vendor/bin/sail ${named} ${inside}`
    case 'kubectl':
      return `kubectl exec -it ${named} -- ${inside}`
    default:
      return `${engine} exec -it ${named} ${inside}`
  }
}

export const engineNames = ENGINES
