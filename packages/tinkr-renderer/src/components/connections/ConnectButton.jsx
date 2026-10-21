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
 *
 * A Laravel Cloud connection is not connectable until an environment is chosen,
 * because the environment is where its code runs: a connection with an
 * application and no environment has nowhere to send anything. The button says
 * that by being inert, which is the app's one way of saying it.
 */
const ConnectButton = () => {
  const {handleSubmit, watch} = useFormContext()
  const connectConnection = useSetAtom(connectConnectionAtom)

  const cloud = Boolean(watch('is_cloud'))
  const environment = watch('cloud_environment_id') || ''

  // a container's command is what reaching into it is: the form's fields are
  // what was chosen, and this is what a session starts with — so it is built
  // once, here, and every path that saves the connection gets the same command
  const onSubmit = data => {
    const built = data.is_cloud
      ? ''
      : (data.container_engine ? containerCommand(data) : data.command)

    connectConnection(Object.assign({}, data, {command: built}))
  }

  return (
    <button
      className='btn btn--primary'
      type='button'
      disabled={cloud && environment === ''}
      onClick={handleSubmit(onSubmit)}
    >
      <FormattedMessage
        id='connections.connect'
      />
    </button>
  )
}

export default ConnectButton
