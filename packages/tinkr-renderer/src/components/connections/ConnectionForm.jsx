import PropTypes from 'prop-types'
import {useCallback, useEffect} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'
import {useFormContext} from 'react-hook-form'
import debounce from 'lodash/debounce'

import ConnectButton from './ConnectButton'
import ConnectionType from './ConnectionType'
import SSHForm from './SSHForm'
import BasicForm from './BasicForm'

/**
 * The connection as the design's dialog: the type row, the fields on one shared
 * label column, and the window's one gradient control in the footer.
 *
 * Nothing has to be saved by hand — every change is written back after a pause,
 * so the footer holds only Connect. The form itself never navigates: Enter is
 * swallowed, and Connect is what hands the values to the main process. The
 * header's close, which the design draws with Esc beside it, is the way out of
 * the dialog without connecting.
 */
const ConnectionForm = ({onSubmit, onClose}) => {
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

  // auto save connections
  useEffect(() => {
    if (data.id) {
      debouncedSave(data)
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
      className='modal'
      role='dialog'
      aria-modal='true'
      aria-labelledby='connection-title'
      style={{display: 'flex', flexDirection: 'column', maxHeight: '100%'}}
    >
      <header className='modal__header row'>
        <h2
          id='connection-title'
          className='grow'
          style={{fontSize: 'var(--fs-lg)'}}
        >
          {data.name || <FormattedMessage id='connections.create'/>}
        </h2>

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
      </header>

      <div
        className='modal__body'
        style={{overflowY: 'auto'}}
      >
        <ConnectionType/>

        <form
          className='form-grid'
          style={{marginTop: 'var(--s4)'}}
          onSubmit={event => event.preventDefault()}
        >
          <input
            type='hidden'
            style={{display: 'none'}}
            {...register('id')}
          />

          <BasicForm/>
          <SSHForm/>
        </form>
      </div>

      <footer className='modal__footer'>
        <ConnectButton/>
      </footer>
    </div>
  )
}

ConnectionForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
}

export default ConnectionForm
