import {Controller, useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

/**
 * Where the tinker process runs: on this machine, inside a container, or over
 * an SSH tunnel.
 *
 * The app keeps one answer, in `is_over_ssh` for ssh and in `container_engine`
 * for a container — a connection with neither is a local one, which is what
 * every connection saved before containers was. The three tabs are the design's
 * segmented control, and the two it does not pick are cleared, so a connection
 * is never both a container and ssh.
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
        const kind = value ? 'ssh' : (engine ? 'container' : 'local')

        const choose = next => {
          if (next === 'ssh') {
            onChange(true)
            setValue('container_engine', '', {shouldDirty: true})

            return
          }

          onChange(false)

          if (next === 'container') {
            // the engine a container connection starts on: docker is what most
            // projects ship in, and it is what the fields below are for
            setValue('container_engine', engine || 'docker', {shouldDirty: true})

            return
          }

          setValue('container_engine', '', {shouldDirty: true})
        }

        const options = [
          ['local', intl.formatMessage({id: 'connections.kind_local'})],
          ['container', intl.formatMessage({id: 'connections.kind_container'})],
          ['ssh', intl.formatMessage({id: 'connections.kind_ssh'})],
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
