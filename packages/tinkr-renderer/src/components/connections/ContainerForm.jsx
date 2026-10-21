import {useEffect, useState} from 'react'
import {useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

import Field from '../Field'
import Section from './Section'
import {listContainers, listProjectDirs} from '../../utils/api'

// the engines a container connection can be built for, in the order the app
// offers them: the two docker-compatible ones, Laravel's wrapper, then
// kubernetes
const ENGINES = ['docker', 'podman', 'sail', 'kubectl']

/**
 * What the engine is running, and where the projects in it are.
 *
 * A container's name is not something to type: a compose file and a PaaS name
 * one per deploy (`app-abc123`), so a name saved in a connection is stale after
 * the next one. So the field is filled from what is running now — and it stays a
 * text field, because a machine the app cannot reach, and an engine it cannot
 * list, are ones where a typed name is still the only name there is.
 *
 * The read happens on the connection as the form currently holds it, which is
 * why both pickers wait for the fields they need: listing containers is a
 * question for the machine, and the machine is the ssh server.
 *
 * The connection's own id goes with the question, because a saved password is
 * kept under it: a read made without one is a read the helper cannot answer.
 *
 * @param {Record<String, any>} connection what the form holds
 * @return {{containers: Array, dirs: Array, loading: Object}}
 */
const useDiscovery = ({id, container_engine: engine, container_name: name, is_over_ssh: ssh, ssh_server: server, ssh_port: port, ssh_user: user, ssh_password: saved}) => {
  const [containers, setContainers] = useState([])
  const [dirs, setDirs] = useState([])
  const [loading, setLoading] = useState({containers: false, dirs: false})

  // a container is listed once the machine it runs on is known: this machine
  // needs nothing, and one over ssh needs the server and the user to reach
  const reachable = Boolean(engine) && (!ssh || (server && user))

  useEffect(() => {
    let live = true

    if (!reachable) {
      setContainers([])

      return () => { live = false }
    }

    setLoading(one => Object.assign({}, one, {containers: true}))

    listContainers({
      id,
      container_engine: engine,
      is_over_ssh: ssh,
      ssh_server: server,
      ssh_port: port,
      ssh_user: user,
      ssh_password: saved,
    })
      .then(found => {
        if (live) {
          setContainers(found)
        }
      })
      // a machine that could not answer is one with nothing to offer, and the
      // field stays typeable
      .catch(() => { if (live) { setContainers([]) } })
      .finally(() => { if (live) { setLoading(one => Object.assign({}, one, {containers: false})) } })

    return () => { live = false }
  }, [reachable, id, engine, ssh, server, port, user, saved])

  useEffect(() => {
    let live = true

    if (!reachable || !name) {
      setDirs([])

      return () => { live = false }
    }

    setLoading(one => Object.assign({}, one, {dirs: true}))

    listProjectDirs({
      id,
      container_engine: engine,
      container_name: name,
      is_over_ssh: ssh,
      ssh_server: server,
      ssh_port: port,
      ssh_user: user,
      ssh_password: saved,
    })
      .then(found => {
        if (live) {
          setDirs(found)
        }
      })
      .catch(() => { if (live) { setDirs([]) } })
      .finally(() => { if (live) { setLoading(one => Object.assign({}, one, {dirs: false})) } })

    return () => { live = false }
  }, [reachable, id, engine, ssh, server, port, user, saved, name])

  return {containers, dirs, loading}
}

/**
 * A project that lives in a container: the engine, the container and the
 * command the app runs inside it.
 *
 * The container and its project's directory are picked from what the engine
 * reports rather than typed, because neither is stable: a deployed container is
 * named per release, and the project inside it sits wherever the image put it.
 * Both stay editable, so a machine that cannot be listed is still reachable by
 * hand.
 *
 * The fields are what the connection stores; the command itself is built from
 * them when the form changes, so a container is changed by picking a different
 * one rather than by editing a command line.
 */
const ContainerForm = () => {
  const intl = useIntl()
  const {register, watch} = useFormContext()
  const engine = watch('container_engine')
  const name = watch('container_name')
  const ssh = watch('is_over_ssh')
  const server = watch('ssh_server')
  const user = watch('ssh_user')

  const {containers, dirs, loading} = useDiscovery({
    id: watch('id'),
    container_engine: engine,
    container_name: name,
    is_over_ssh: ssh,
    ssh_server: server,
    ssh_port: watch('ssh_port'),
    ssh_user: user,
    ssh_password: watch('ssh_password'),
  })

  if (!engine) {
    return null
  }

  const listId = 'connection-container-names'
  const dirsId = 'connection-container-paths'

  return (
    <Section
      id='connection-container'
      title={intl.formatMessage({id: 'connections.section_container'})}
    >
      <Field
        label={intl.formatMessage({id: 'connections.container_engine'})}
        labelId='connection-container-engine-label'
      >
        <div
          className='segmented segmented--fill'
          role='radiogroup'
          aria-labelledby='connection-container-engine-label'
        >
          {ENGINES.map(one => (
            <label
              key={one}
              className='segmented__item'
            >
              <input
                type='radio'
                value={one}
                {...register('container_engine')}
              />
              {one}
            </label>
          ))}
        </div>
      </Field>

      {/* a datalist and not a select: what is running is what is offered, and a
          name that is not in it is still a name the session can be given */}
      <Field
        label={intl.formatMessage({id: 'connections.container_name'})}
        htmlFor='connection-container-name'
      >
        <input
          className='input input--mono'
          id='connection-container-name'
          name='container_name'
          type='text'
          list={listId}
          placeholder={loading.containers
            ? intl.formatMessage({id: 'connections.container_loading'})
            : intl.formatMessage({id: 'connections.container_placeholder'})}
          spellCheck={false}
          autoComplete='off'
          {...register('container_name')}
        />

        <datalist id={listId}>
          {containers.map(one => (
            <option
              key={one.name}
              value={one.name}
            >
              {one.image}
            </option>
          ))}
        </datalist>

        {containers.length === 0 && !loading.containers && (
          <p className='cfield__note'>
            {intl.formatMessage({id: 'connections.container_none'})}
          </p>
        )}
      </Field>

      {/* the project path below is the machine's, which is what the directory
          picker and a local index read. A container sees the project somewhere
          of its own — compose mounts it where the image expects — and this is
          where the reads that index the project and tail its logs go looking */}
      <Field
        label={intl.formatMessage({id: 'connections.container_path'})}
        htmlFor='connection-container-path'
      >
        <input
          className='input input--mono'
          id='connection-container-path'
          name='container_path'
          type='text'
          list={dirsId}
          placeholder={loading.dirs
            ? intl.formatMessage({id: 'connections.container_loading'})
            : intl.formatMessage({id: 'connections.container_path_placeholder'})}
          spellCheck={false}
          autoComplete='off'
          {...register('container_path')}
        />

        <datalist id={dirsId}>
          {dirs.map(dir => (
            <option key={dir} value={dir}/>
          ))}
        </datalist>
      </Field>

      <Field
        label={intl.formatMessage({id: 'connections.container_command'})}
        htmlFor='connection-container-command'
      >
        <input
          className='input input--mono'
          id='connection-container-command'
          name='container_command'
          type='text'
          placeholder='php artisan tinker'
          spellCheck={false}
          autoComplete='off'
          {...register('container_command')}
        />
      </Field>
    </Section>
  )
}

export default ContainerForm
