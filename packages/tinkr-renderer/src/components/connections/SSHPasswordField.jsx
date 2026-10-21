import {useIntl} from 'react-intl'
import {useFormContext} from 'react-hook-form'
import {useSetAtom} from 'jotai'

import Field from '../Field'
import SSHKeyButton from './SSHKeyButton'
import {forgetPassword} from '../../utils/api'
import {connectionDataAtom} from '../../stores/connections'

/**
 * The password a connection logs in with.
 *
 * The field is write-only: the app never shows a saved password back, because a
 * password on screen is a password someone can read over a shoulder, in a
 * screenshot, or in a screen share. It says whether one is kept instead, and the
 * only way to stop using it is the action beside the field.
 *
 * What is typed here is handed to the main process with the rest of the form and
 * never comes back: the renderer keeps no copy of it, and the saved form is
 * stripped of it before it lands in the store the window reads.
 *
 * A password is a way in when the connection has no key, and the key is the way
 * in that leaves nothing on disk to steal, so the hint says what the field is
 * for rather than offering the two as equals.
 */
const SSHPasswordField = () => {
  const intl = useIntl()
  const {register, setValue, watch} = useFormContext()
  const setConnections = useSetAtom(connectionDataAtom)

  const id = watch('id')
  const saved = Boolean(watch('ssh_password'))

  const forget = () => {
    // the main process removes the secret and the connection's claim to one;
    // what the window holds is the same fact, cleared here so the form says so
    forgetPassword(id)

    setValue('ssh_password', false, {shouldDirty: true})
    setConnections(data => {
      if (data[id]) {
        data[id].ssh_password = false
      }
    })
  }

  return (
    <Field
      label={intl.formatMessage({id: 'connections.ssh_password'})}
      htmlFor='connection-ssh-password'
    >
      <input
        className='input'
        id='connection-ssh-password'
        name='password'
        type='password'
        placeholder={saved
          ? intl.formatMessage({id: 'connections.ssh_password_saved'})
          : intl.formatMessage({id: 'connections.ssh_password_placeholder'})}
        spellCheck={false}
        // a password manager offering to fill this is offering to type a
        // password that is not this connection's, and the field is not a login
        // form for a browser to keep
        autoComplete='new-password'
        {...register('password')}
      />

      {saved && (
        <div className='cfield__note'>
          <span className='grow'>
            {intl.formatMessage({id: 'connections.ssh_password_kept'})}
          </span>

          <button
            className='btn btn--ghost btn--sm'
            type='button'
            onClick={forget}
          >
            {intl.formatMessage({id: 'connections.ssh_password_forget'})}
          </button>
        </div>
      )}
    </Field>
  )
}

export default SSHPasswordField
