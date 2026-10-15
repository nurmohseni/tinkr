import {FormattedMessage} from 'react-intl'
import {Controller, useFormContext} from 'react-hook-form'

import SSHKeyTooltip from './SSHKeyTooltip'
import {selectFile} from '../../utils/api'

/**
 * The private key: one secondary action that opens the file picker, labelled
 * with the chosen file's name once there is one, and the hint beside it.
 */
const SSHKeyButton = () => {
  const {control} = useFormContext()

  return (
    <Controller
      name='ssh_key'
      control={control}
      defaultValue=''
      render={({
        field: {value, onChange},
      }) => (
        <div className='row'>
          <button
            className='btn btn--secondary'
            id='connection-ssh-key'
            type='button'
            onClick={() => onChange(selectFile())}
          >
            {value
              ? value.split('/').pop()
              : <FormattedMessage id='connections.import_ssh_key'/>}
          </button>

          <SSHKeyTooltip/>
        </div>
      )}
    />
  )
}

export default SSHKeyButton
