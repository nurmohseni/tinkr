import {useEffect, useState} from 'react'
import {useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

import Field from '../Field'
import Section from './Section'
import {listContainers, listProjectDirs, listKubeContexts, listKubeNamespaces} from '../../utils/api'

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
 * A pod is reached in a namespace, in a context, from a kubeconfig, and in one of
 * its containers, so those fields are part of every question a kubectl connection
 * asks. The pods are asked for again when the namespace or the context changes,
 * because they are a different set of pods: what the listing answered for the
 * context's own namespace says nothing about another one.
 *
 * @param {Record<String, any>} connection what the form holds
 * @return {{containers: Array, dirs: Array, contexts: Array, namespaces: Array, loading: Object}}
 */
const useDiscovery = ({
  id, container_engine: engine, container_name: name,
  is_over_ssh: ssh, ssh_server: server, ssh_port: port, ssh_user: user, ssh_key: key, ssh_password: saved,
  kube_config: kubeconfig, kube_context: context, kube_namespace: namespace, kube_container: podContainer,
}) => {
  const [containers, setContainers] = useState([])
  const [dirs, setDirs] = useState([])
  const [contexts, setContexts] = useState([])
  const [namespaces, setNamespaces] = useState([])
  const [loading, setLoading] = useState({containers: false, dirs: false})

  // a container is listed once the machine it runs on is known: this machine
  // needs nothing, and one over ssh needs the server and the user to reach
  const reachable = Boolean(engine) && (!ssh || (server && user))
  // the cluster's own two lists are a question about a pod connection, and are
  // not put to an engine that has no clusters
  const pod = engine === 'kubectl'

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
      ssh_key: key,
      ssh_password: saved,
      // what says which pod the listing is of: another namespace or another
      // context is another list of pods, and no container of a pod is named,
      // because the listing is of the pods themselves
      kube_config: kubeconfig,
      kube_context: context,
      kube_namespace: namespace,
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
  }, [reachable, id, engine, ssh, server, port, user, key, saved, kubeconfig, context, namespace])

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
      ssh_key: key,
      ssh_password: saved,
      kube_config: kubeconfig,
      kube_context: context,
      kube_namespace: namespace,
      kube_container: podContainer,
    })
      .then(found => {
        if (live) {
          setDirs(found)
        }
      })
      .catch(() => { if (live) { setDirs([]) } })
      .finally(() => { if (live) { setLoading(one => Object.assign({}, one, {dirs: false})) } })

    return () => { live = false }
  }, [reachable, id, engine, ssh, server, port, user, key, saved, name, kubeconfig, context, namespace, podContainer])

  // the contexts are the kubeconfig's, so only the file that is asked for is
  // part of the question: a context is chosen from them, not needed to list them
  useEffect(() => {
    let live = true

    if (!pod || !reachable) {
      setContexts([])

      return () => { live = false }
    }

    listKubeContexts({
      id,
      is_over_ssh: ssh,
      ssh_server: server,
      ssh_port: port,
      ssh_user: user,
      ssh_key: key,
      ssh_password: saved,
      kube_config: kubeconfig,
    })
      .then(found => { if (live) { setContexts(found) } })
      .catch(() => { if (live) { setContexts([]) } })

    return () => { live = false }
  }, [pod, reachable, id, ssh, server, port, user, key, saved, kubeconfig])

  // and the namespaces are the cluster's, which is the file and the context
  useEffect(() => {
    let live = true

    if (!pod || !reachable) {
      setNamespaces([])

      return () => { live = false }
    }

    listKubeNamespaces({
      id,
      is_over_ssh: ssh,
      ssh_server: server,
      ssh_port: port,
      ssh_user: user,
      ssh_key: key,
      ssh_password: saved,
      kube_config: kubeconfig,
      kube_context: context,
    })
      .then(found => { if (live) { setNamespaces(found) } })
      .catch(() => { if (live) { setNamespaces([]) } })

    return () => { live = false }
  }, [pod, reachable, id, ssh, server, port, user, key, saved, kubeconfig, context])

  return {containers, dirs, contexts, namespaces, loading}
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
 * A pod is not the whole of where it is: it is in a namespace, in a cluster
 * reached by a context, from a kubeconfig, and it may run several containers of
 * which one is the project's. Those four are the kubectl connection's own fields,
 * offered as what the file and the cluster hold and typeable all the same, and
 * they are shown only for kubectl, because no other engine has them.
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

  const {containers, dirs, contexts, namespaces, loading} = useDiscovery({
    id: watch('id'),
    container_engine: engine,
    container_name: name,
    is_over_ssh: ssh,
    ssh_server: server,
    ssh_port: watch('ssh_port'),
    ssh_user: user,
    ssh_key: watch('ssh_key'),
    ssh_password: watch('ssh_password'),
    kube_config: watch('kube_config'),
    kube_context: watch('kube_context'),
    kube_namespace: watch('kube_namespace'),
    kube_container: watch('kube_container'),
  })

  if (!engine) {
    return null
  }

  const listId = 'connection-container-names'
  const dirsId = 'connection-container-paths'
  const contextsId = 'connection-kube-contexts'
  const namespacesId = 'connection-kube-namespaces'

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

      {/* a pod is where its namespace and its cluster say it is, so the two that
          name those come first, and the file and the container of the pod under
          them. All four are what kubectl's own flags take, and all four stay
          typeable: a machine the app cannot list is still a machine a pod is in */}
      {engine === 'kubectl' && (
        <>
          <Field
            label={intl.formatMessage({id: 'connections.kube_namespace'})}
            htmlFor='connection-kube-namespace'
          >
            <input
              className='input input--mono'
              id='connection-kube-namespace'
              name='kube_namespace'
              type='text'
              list={namespacesId}
              placeholder={intl.formatMessage({id: 'connections.kube_namespace_placeholder'})}
              spellCheck={false}
              autoComplete='off'
              {...register('kube_namespace')}
            />

            <datalist id={namespacesId}>
              {namespaces.map(one => (
                <option key={one} value={one}/>
              ))}
            </datalist>
          </Field>

          <Field
            label={intl.formatMessage({id: 'connections.kube_context'})}
            htmlFor='connection-kube-context'
          >
            <input
              className='input input--mono'
              id='connection-kube-context'
              name='kube_context'
              type='text'
              list={contextsId}
              placeholder={intl.formatMessage({id: 'connections.kube_context_placeholder'})}
              spellCheck={false}
              autoComplete='off'
              {...register('kube_context')}
            />

            <datalist id={contextsId}>
              {contexts.map(one => (
                <option key={one} value={one}/>
              ))}
            </datalist>
          </Field>

          <Field
            label={intl.formatMessage({id: 'connections.kube_config'})}
            htmlFor='connection-kube-config'
          >
            <input
              className='input input--mono'
              id='connection-kube-config'
              name='kube_config'
              type='text'
              placeholder={intl.formatMessage({id: 'connections.kube_config_placeholder'})}
              spellCheck={false}
              autoComplete='off'
              {...register('kube_config')}
            />
          </Field>

          <Field
            label={intl.formatMessage({id: 'connections.kube_container'})}
            htmlFor='connection-kube-container'
          >
            <input
              className='input input--mono'
              id='connection-kube-container'
              name='kube_container'
              type='text'
              placeholder={intl.formatMessage({id: 'connections.kube_container_placeholder'})}
              spellCheck={false}
              autoComplete='off'
              {...register('kube_container')}
            />
          </Field>
        </>
      )}

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
