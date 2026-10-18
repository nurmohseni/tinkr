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
  docker: {
    exec: ({name, command}) => `docker exec -it ${name} ${command}`,
  },
  podman: {
    exec: ({name, command}) => `podman exec -it ${name} ${command}`,
  },
  // sail is laravel's wrapper around docker compose: the "container" is the
  // service name, and the command is what the compose file runs
  sail: {
    exec: ({name, command}) => `./vendor/bin/sail ${name} ${command}`,
  },
  kubectl: {
    exec: ({name, command}) => `kubectl exec -it ${name} -- ${command}`,
  },
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
 * The command a container connection runs, or '' when it names no container.
 *
 * Nothing is guessed about a name that is not there: a container connection with
 * no container is not a connection, and the form says so by leaving the command
 * empty rather than building `docker exec -it  php artisan tinker`.
 *
 * @param {ContainerConnection} connection
 * @return {String}
 */
const containerCommand = ({container_engine: engine, container_name: name, container_command: command} = {}) => {
  const chosen = engines[engine]
  const container = String(name || '').trim()

  if (!chosen || !container) {
    return ''
  }

  const inside = String(command || '').trim() || 'php artisan tinker'

  return chosen.exec({name: word(container), command: inside})
}

/**
 * What kind of connection this is, for everything that only needs to know that.
 *
 * The app stores the kind rather than deriving it every time: a connection saved
 * before there were containers is a local one or an ssh one, and `is_over_ssh`
 * is what it always was.
 *
 * @param {Record<String, any>} connection
 * @return {String} `local`, `ssh` or `container`
 */
const connectionKind = connection => {
  if (connection && connection.is_over_ssh) {
    return 'ssh'
  }

  if (connection && connection.container_engine) {
    return 'container'
  }

  return 'local'
}

module.exports = {
  engines,
  engineNames,
  containerCommand,
  connectionKind,
  word,
}
