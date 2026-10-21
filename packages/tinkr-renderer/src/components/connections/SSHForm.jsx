import {useIntl} from 'react-intl'
import {useFormContext} from 'react-hook-form'

import Field from '../Field'
import Section from './Section'
import SSHKeyButton from './SSHKeyButton'
import SSHPasswordField from './SSHPasswordField'

/**
 * The fields the tunnel needs, shown only when the connection runs over SSH.
 *
 * The user, the host and the port are one address — `deploy@10.0.4.12:22` is
 * how ssh itself is told where to go — so they are written in one field the way
 * the address is written anywhere else, each part still an input of its own
 * with its own name. Then the two ways in: the key the app authenticates with,
 * and a password for a server that takes one.
 */
const SSHForm = () => {
  const intl = useIntl()
  const {register, watch, setFocus} = useFormContext()

  const isOverSSH = watch('is_over_ssh')

  if (!isOverSSH) {
    return null
  }

  return (
    <Section
      id='connection-server'
      title={intl.formatMessage({id: 'connections.section_server'})}
    >
      <Field
        label={intl.formatMessage({id: 'connections.ssh_address'})}
        htmlFor='connection-ssh-server'
      >
        <div className='well address'>
          <input
            className='well__input input--mono address__user'
            id='connection-ssh-user'
            name='ssh_user'
            type='text'
            aria-label={intl.formatMessage({id: 'connections.ssh_user'})}
            placeholder='root'
            spellCheck={false}
            autoComplete='off'
            {...register('ssh_user')}
          />

          <span className='address__sep' aria-hidden='true'>@</span>

          <input
            className='well__input input--mono address__host'
            id='connection-ssh-server'
            name='ssh_server'
            type='text'
            aria-label={intl.formatMessage({id: 'connections.ssh_server'})}
            placeholder='192.168.1.1'
            spellCheck={false}
            autoComplete='off'
            {...register('ssh_server')}
          />

          <span className='address__sep' aria-hidden='true'>:</span>

          <input
            className='well__input input--mono address__port'
            id='connection-ssh-port'
            name='ssh_port'
            type='text'
            inputMode='numeric'
            aria-label={intl.formatMessage({id: 'connections.ssh_port'})}
            placeholder='22'
            spellCheck={false}
            autoComplete='off'
            {...register('ssh_port')}
          />

          <span
            className='address__rest'
            aria-hidden='true'
            onMouseDown={event => {
              event.preventDefault()
              setFocus('ssh_server')
            }}
          />
        </div>
      </Field>

      <Field
        label={intl.formatMessage({id: 'connections.ssh_key'})}
        htmlFor='connection-ssh-key'
      >
        <SSHKeyButton/>
      </Field>

      {/* a connection with a key needs no password, and one with neither is
          reached the way ssh already reaches it: the terminal asks */}
      <SSHPasswordField/>
    </Section>
  )
}

export default SSHForm
