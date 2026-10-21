import PropTypes from 'prop-types'
import {useCallback, useEffect} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'
import {useFormContext} from 'react-hook-form'
import debounce from 'lodash/debounce'

import ConnectButton from './ConnectButton'
import ConnectionType from './ConnectionType'
import ConnectionRoute from './ConnectionRoute'
import SSHForm from './SSHForm'
import BasicForm from './BasicForm'
import ContainerForm from './ContainerForm'
import {containerCommand} from '../../utils/containerCommand'

/**
 * The connection as a two-part dialog. The head is the connection's identity:
 * its name, typed where a title would be, and under it the route a session
 * takes to the project, read live from the fields. The body pairs the rail that
 * says where the code runs with the sections that kind needs, in the order the
 * session reaches them. The foot says how the form keeps what is typed, and
 * holds Connect.
 *
 * Nothing has to be saved by hand — every change to a stored connection is
 * written back after a pause. The form itself never navigates: Enter is
 * swallowed, and Connect is what hands the values to the main process. The
 * close in the head, with Esc beside it, is the way out of the dialog without
 * connecting.
 */
const ConnectionForm = ({onSubmit, onClose, draft}) => {
  const {watch, register} = useFormContext()
  const intl = useIntl()

  const data = watch()

  // debounce the update
  // https://www.synthace.com/autosave-with-react-hooks/
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(
    debounce(dataNew => {
      onSubmit(dataNew)
    }, 500),
    [],
  )

  // auto save connections. A container's command is built from what it runs in,
  // so what is saved is the connection with the command it would start with —
  // which is also what a run reads
  useEffect(() => {
    if (data.id) {
      const built = data.container_engine
        ? containerCommand(data)
        : data.command

      debouncedSave(built === data.command ? data : Object.assign({}, data, {command: built}))
    }
  }, [data])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div
      className='modal cdialog'
      role='dialog'
      aria-modal='true'
      aria-labelledby='connection-name'
    >
      <header className='cdialog__head'>
        <div className='cdialog__title'>
          <input
            className='cdialog__name'
            id='connection-name'
            name='name'
            type='text'
            aria-label={intl.formatMessage({id: 'connections.name'})}
            placeholder={intl.formatMessage({id: 'connections.name_default'})}
            spellCheck={false}
            autoComplete='off'
            {...register('name')}
          />

          <kbd className='keycap' aria-hidden='true'>Esc</kbd>

          <button
            className='btn btn--ghost btn--icon btn--sm'
            type='button'
            title={intl.formatMessage({id: 'close'})}
            aria-label={intl.formatMessage({id: 'close'})}
            onClick={onClose}
          >
            <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'>
              <path d='M2 2l6 6M8 2l-6 6' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round'/>
            </svg>
          </button>
        </div>

        <ConnectionRoute/>
      </header>

      <div className='cdialog__body'>
        <ConnectionType/>

        <form
          className='cdialog__fields'
          onSubmit={event => event.preventDefault()}
        >
          <input
            type='hidden'
            style={{display: 'none'}}
            {...register('id')}
          />

          {/* in the order a session reaches them: the server, then the
              container on it, then the project the container holds */}
          <SSHForm/>
          <ContainerForm/>
          <BasicForm/>
        </form>
      </div>

      <footer className='cdialog__foot'>
        <span className='cdialog__note'>
          <FormattedMessage id={draft ? 'connections.saved_on_connect' : 'connections.saved_as_you_type'}/>
        </span>

        <ConnectButton/>
      </footer>
    </div>
  )
}

ConnectionForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  // a connection the dialog is still drafting: nothing of it is written until
  // Connect, and the foot says so
  draft: PropTypes.bool,
}

export default ConnectionForm
