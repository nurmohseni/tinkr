import {useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

import Field from '../Field'

// the engines a container connection can be built for, in the order the app
// offers them: the two docker-compatible ones, Laravel's wrapper, then
// kubernetes
const ENGINES = ['docker', 'podman', 'sail', 'kubectl']

/**
 * A project that lives in a container: the engine, the container and the
 * command the app runs inside it.
 *
 * A container connection is a local one whose command reaches into the
 * container — the files are on this machine, mounted in, and the php that runs
 * the code is inside. So the project path above is still the host's directory,
 * which is what the index and the log viewer read, and this is the command.
 *
 * The three fields are what the connection stores; the command itself is built
 * from them when the form changes, so a container is changed by picking a
 * different one rather than by editing a command line.
 */
const ContainerForm = () => {
  const intl = useIntl()
  const {register, watch} = useFormContext()
  const engine = watch('container_engine')

  if (!engine) {
    return null
  }

  return (
    <>
      <Field
        label={intl.formatMessage({id: 'connections.container_engine'})}
        htmlFor='connection-container-engine'
      >
        <select
          className='select'
          id='connection-container-engine'
          style={{width: '100%'}}
          {...register('container_engine')}
        >
          {ENGINES.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </Field>

      <Field
        label={intl.formatMessage({id: 'connections.container_name'})}
        htmlFor='connection-container-name'
      >
        <input
          className='input'
          id='connection-container-name'
          name='container_name'
          type='text'
          placeholder={intl.formatMessage({id: 'connections.container_placeholder'})}
          spellCheck={false}
          autoComplete='off'
          style={{fontFamily: 'var(--font-mono)'}}
          {...register('container_name')}
        />
      </Field>

      <Field
        label={intl.formatMessage({id: 'connections.container_command'})}
        htmlFor='connection-container-command'
      >
        <input
          className='input'
          id='connection-container-command'
          name='container_command'
          type='text'
          placeholder='php artisan tinker'
          spellCheck={false}
          autoComplete='off'
          style={{fontFamily: 'var(--font-mono)'}}
          {...register('container_command')}
        />
      </Field>
    </>
  )
}

export default ContainerForm
