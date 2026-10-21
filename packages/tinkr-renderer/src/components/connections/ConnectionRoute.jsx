import {useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'
import {useAtomValue} from 'jotai'

import {configAtom} from '../../stores/config'

/**
 * The way a session reaches the project, as it stands while the form is filled
 * in: the server, the container, the directory, and the command that starts
 * tinker there. Each stop is the value the form holds, so the line is what
 * Connect is about to do, and a stop still to be filled in reads as the name of
 * its field, faint, where its value will go.
 *
 * It follows what the session does rather than what the form shows: a project
 * in a container runs in the container's directory, and a command left empty is
 * the default command from the settings.
 */
const ConnectionRoute = () => {
  const intl = useIntl()
  const {watch} = useFormContext()
  const config = useAtomValue(configAtom)

  const [ssh, server, port, user, engine, name, inContainer, path, command, inside] = watch([
    'is_over_ssh', 'ssh_server', 'ssh_port', 'ssh_user',
    'container_engine', 'container_name', 'container_path',
    'path', 'command', 'container_command',
  ])

  const say = id => intl.formatMessage({id})
  const text = value => String(value || '').trim()

  const stops = []

  if (ssh) {
    const host = text(server)
    const at = text(user)

    stops.push(host
      ? {value: `${at ? `${at}@` : ''}${host}${text(port) ? `:${text(port)}` : ''}`}
      : {missing: say('connections.ssh_server')})
  }

  if (engine) {
    stops.push(text(name)
      ? {value: `${engine} ${text(name)}`}
      : {missing: say('connections.container_name')})
  }

  // docker and podman are told where to run with -w; sail runs from the project
  // on the machine, where its compose file is; kubectl has no working directory
  // of its own to be given, so the pod's is the one there is
  if (engine !== 'kubectl') {
    const dir = engine && engine !== 'sail' ? (text(inContainer) || text(path)) : text(path)

    stops.push(dir ? {value: dir} : {missing: say('connections.path')})
  }

  const run = engine ? text(inside) : text(command)

  stops.push(run
    ? {value: run, last: true}
    : {value: engine ? 'php artisan tinker' : config.command_default, implied: true, last: true})

  return (
    <ol
      className='route'
      aria-label={say('connections.route')}
    >
      {stops.map((stop, index) => (
        <li
          key={index}
          className={[
            'route__stop',
            stop.missing && 'route__stop--missing',
            stop.implied && 'route__stop--implied',
            stop.last && 'route__stop--last',
          ].filter(Boolean).join(' ')}
          title={stop.value || stop.missing}
        >
          <span className='route__text'>{stop.value || stop.missing}</span>
        </li>
      ))}
    </ol>
  )
}

export default ConnectionRoute
