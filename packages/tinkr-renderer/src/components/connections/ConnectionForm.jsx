import PropTypes from 'prop-types'
import {useEffect} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'
import {useFormContext} from 'react-hook-form'

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
 * session reaches them. The foot says what an edit waits for, and holds Save
 * and Connect.
 *
 * An edit to a stored connection is written when Save is pressed, and not
 * before: closing the dialog — the close in the head, or Esc — leaves the
 * connection as it was. Save is offered once something changed. Connect is
 * also a save, because the session it starts reads the stored connection. The
 * form itself never navigates: Enter is swallowed.
 */
const ConnectionForm = ({onSubmit, onClose, draft}) => {
  const {register, handleSubmit, formState: {isDirty}} = useFormContext()
  const intl = useIntl()

  // a container's command is built from what it runs in, so what is saved is
  // the connection with the command it would start with — which is also what a
  // run reads
  const save = handleSubmit(data => {
    const built = data.container_engine ? containerCommand(data) : data.command

    onSubmit(built === data.command ? data : Object.assign({}, data, {command: built}))
    onClose()
  })

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
        <span className='cdialog__note' role='status'>
          <FormattedMessage id={draft
            ? 'connections.saved_on_connect'
            : isDirty ? 'connections.unsaved_changes' : 'connections.saved_on_save'}
          />
        </span>

        <div className='cdialog__actions'>
          {!draft && (
            <button
              className='btn btn--secondary'
              type='button'
              disabled={!isDirty}
              onClick={save}
            >
              <FormattedMessage id='connections.save'/>
            </button>
          )}

          <ConnectButton/>
        </div>
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
