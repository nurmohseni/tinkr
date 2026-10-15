import {FormattedMessage} from 'react-intl'
import {useFormContext} from 'react-hook-form'
import {useSetAtom} from 'jotai'

import {connectConnectionAtom} from '../../stores/connections'

/**
 * Connect: hands the form's values to the main process, which switches this
 * window's session to them. For a connection the dialog is still drafting, this
 * is also the confirmation that creates it — the store learns of it here, and
 * only here.
 */
const ConnectButton = () => {
  const {handleSubmit} = useFormContext()
  const connectConnection = useSetAtom(connectConnectionAtom)

  const onSubmit = data => {
    connectConnection(data)
  }

  return (
    <button
      className='btn btn--primary'
      type='button'
      onClick={handleSubmit(onSubmit)}
    >
      <FormattedMessage
        id='connections.connect'
      />
    </button>
  )
}

export default ConnectButton
