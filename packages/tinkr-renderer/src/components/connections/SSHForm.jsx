import {useIntl} from 'react-intl'
import {useFormContext} from 'react-hook-form'

import Field from '../Field'
import SSHKeyButton from './SSHKeyButton'

/**
 * The fields the tunnel needs, shown only when the connection runs over SSH:
 * host, port, user and the key the app authenticates with.
 */
const SSHForm = () => {
  const intl = useIntl()
  const {register, watch} = useFormContext()

  const isOverSSH = watch('is_over_ssh')

  if (!isOverSSH) {
    return null
  }

  return (
    <>
      <Field
        label={intl.formatMessage({id: 'connections.ssh_server'})}
        htmlFor='connection-ssh-server'
      >
        <input
          className='input'
          id='connection-ssh-server'
          name='ssh_server'
          type='text'
          placeholder='192.168.1.1'
          spellCheck={false}
          autoComplete='off'
          style={{fontFamily: 'var(--font-mono)'}}
          {...register('ssh_server')}
        />
      </Field>

      <Field
        label={intl.formatMessage({id: 'connections.ssh_port'})}
        htmlFor='connection-ssh-port'
      >
        <input
          className='input'
          id='connection-ssh-port'
          name='ssh_port'
          type='text'
          placeholder='22'
          spellCheck={false}
          autoComplete='off'
          style={{fontFamily: 'var(--font-mono)'}}
          {...register('ssh_port')}
        />
      </Field>

      <Field
        label={intl.formatMessage({id: 'connections.ssh_user'})}
        htmlFor='connection-ssh-user'
      >
        <input
          className='input'
          id='connection-ssh-user'
          name='ssh_user'
          type='text'
          placeholder='root'
          spellCheck={false}
          autoComplete='off'
          style={{fontFamily: 'var(--font-mono)'}}
          {...register('ssh_user')}
        />
      </Field>

      <Field
        label={intl.formatMessage({id: 'connections.ssh_key'})}
        htmlFor='connection-ssh-key'
      >
        <SSHKeyButton/>
      </Field>
    </>
  )
}

export default SSHForm
