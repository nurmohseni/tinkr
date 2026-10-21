import {FormattedMessage, useIntl} from 'react-intl'
import {Controller, useFormContext} from 'react-hook-form'

import {selectFile} from '../../utils/api'

/**
 * The private key, as a field: pressing it opens the file picker, and it reads
 * as the key's file name once there is one — the name is what tells two keys
 * apart, and the full path is its title. A chosen key can be let go of from the
 * end of the field.
 *
 * Without a key, ssh signs in the way the user's own config says, and the line
 * under the field says so where the choice is made.
 */
const SSHKeyButton = () => {
  const intl = useIntl()
  const {control} = useFormContext()
  const clear = intl.formatMessage({id: 'connections.ssh_key_clear'})

  return (
    <Controller
      name='ssh_key'
      control={control}
      defaultValue=''
      render={({
        field: {value, onChange},
      }) => (
        <>
          <div className='well'>
            <button
              className={value ? 'well__input filepick' : 'well__input filepick filepick--empty'}
              id='connection-ssh-key'
              type='button'
              title={value || undefined}
              onClick={() => onChange(selectFile())}
            >
              <span className='truncate'>
                {value
                  ? value.split('/').pop()
                  : <FormattedMessage id='connections.import_ssh_key'/>}
              </span>
            </button>

            {value && (
              <button
                className='well__action'
                type='button'
                title={clear}
                aria-label={clear}
                onClick={() => onChange('')}
              >
                <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'>
                  <path d='M2 2l6 6M8 2l-6 6' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round'/>
                </svg>
              </button>
            )}
          </div>

          {!value && (
            <p className='cfield__note'>
              <FormattedMessage id='connections.ssh_key_hint'/>
            </p>
          )}
        </>
      )}
    />
  )
}

export default SSHKeyButton
