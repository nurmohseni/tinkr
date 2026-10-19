import {Controller, useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

/**
 * Where the tinker process runs: on this machine, inside a container, over an
 * SSH tunnel, or inside a container that lives on a server reached over SSH.
 *
 * The app keeps two answers, in `is_over_ssh` for ssh and in `container_engine`
 * for a container, and they are not exclusive: a project deployed by a compose
 * file on a server is a container on that server. The tabs are the design's
 * segmented control and they set both answers, so a tab is one state and not a
 * pair of switches — but the state it sets is two fields, which is what keeps a
 * connection saved before containers readable as it was.
 *
 * A tab that is not chosen clears what it owns: local and ssh clear the
 * container, and the two container tabs keep an engine that is already chosen
 * rather than resetting it to docker under someone who picked podman.
 */
const ConnectionType = () => {
  const intl = useIntl()
  const {control, setValue} = useFormContext()

  return (
    <Controller
      name='is_over_ssh'
      control={control}
      defaultValue={false}
      render={({field: {value, onChange}}) => {
        const engine = control._formValues.container_engine
        const kind = value
          ? (engine ? 'ssh-container' : 'ssh')
          : (engine ? 'container' : 'local')

        const choose = next => {
          const overSsh = next === 'ssh' || next === 'ssh-container'
          const inContainer = next === 'container' || next === 'ssh-container'

          onChange(overSsh)

          // the engine a container connection starts on: docker is what most
          // projects ship in, and it is what the fields below are for
          setValue('container_engine', inContainer ? (engine || 'docker') : '', {shouldDirty: true})

          // an in-container path is the container's, and a connection that is no
          // longer in one has no use for it: the project path is the answer then
          if (!inContainer) {
            setValue('container_path', '', {shouldDirty: true})
          }
        }

        const options = [
          ['local', intl.formatMessage({id: 'connections.kind_local'})],
          ['container', intl.formatMessage({id: 'connections.kind_container'})],
          ['ssh', intl.formatMessage({id: 'connections.kind_ssh'})],
          ['ssh-container', intl.formatMessage({id: 'connections.kind_ssh_container'})],
        ]

        return (
          <div className='segmented segmented--fill'>
            {options.map(([name, label]) => (
              <label
                key={name}
                className='segmented__item'
              >
                <input
                  type='radio'
                  name='connection-type'
                  checked={kind === name}
                  onChange={() => choose(name)}
                />
                {label}
              </label>
            ))}
          </div>
        )
      }}
    />
  )
}

export default ConnectionType
