import {FormattedMessage} from 'react-intl'
import {useFormContext} from 'react-hook-form'
import {useSetAtom} from 'jotai'

import {connectConnectionAtom} from '../../stores/connections'
import {containerCommand} from '../../utils/containerCommand'

/**
 * Connect: hands the form's values to the main process, which switches this
 * window's session to them. For a connection the dialog is still drafting, this
 * is also the confirmation that creates it — the store learns of it here, and
 * only here.
 */
const ConnectButton = () => {
  const {handleSubmit} = useFormContext()
  const connectConnection = useSetAtom(connectConnectionAtom)

  // a container's command is what reaching into it is: the form's fields are
  // what was chosen, and this is what a session starts with — so it is built
  // once, here, and every path that saves the connection gets the same command
  const onSubmit = data => {
    const built = data.container_engine ? containerCommand(data) : data.command

    connectConnection(Object.assign({}, data, {command: built}))
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
