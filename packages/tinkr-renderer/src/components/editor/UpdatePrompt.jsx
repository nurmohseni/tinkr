import {createPortal} from 'react-dom'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import {dismissUpdateAtom, downloadUpdateAtom, updateStateAtom} from '../../stores/update'
import {installUpdate} from '../../utils/api'

/**
 * The app asking about a newer version, as the design's narrow modal.
 *
 * It is the permission: a check runs as the app opens and every few hours after
 * that, and a version it finds is nothing but this panel until someone presses
 * Download. Once it is downloaded, the same panel says when it lands — on the
 * next quit, or now.
 */
const UpdatePrompt = () => {
  const intl = useIntl()
  const state = useAtomValue(updateStateAtom)
  const download = useSetAtom(downloadUpdateAtom)
  const dismiss = useSetAtom(dismissUpdateAtom)

  if (state.status === 'idle') {
    return null
  }

  const downloading = state.status === 'downloading'
  const ready = state.status === 'ready'
  const failed = state.status === 'failed'

  return createPortal(
    <div className='modal-overlay'>
      <div
        className='modal modal--narrow'
        role='dialog'
        aria-modal='true'
        aria-labelledby='update-title'
      >
        <header
          className='modal__header'
          id='update-title'
        >
          <FormattedMessage id={
            ready ? 'update.ready_title' : failed ? 'update.failed_title' : 'update.available_title'
          }/>
        </header>

        <div className='modal__body'>
          {downloading && (
            <FormattedMessage id='update.downloading' values={{percent: state.percent}}/>
          )}
          {ready && <FormattedMessage id='update.ready_content' values={{version: state.version}}/>}
          {failed && <FormattedMessage id='update.failed_content' values={{message: state.message}}/>}
          {!downloading && !ready && !failed && (
            <FormattedMessage id='update.available_content' values={{version: state.version}}/>
          )}
        </div>

        <footer className='modal__footer'>
          {!downloading && (
            <button
              className='btn btn--ghost'
              type='button'
              onClick={dismiss}
            >
              {intl.formatMessage({id: 'update.later'})}
            </button>
          )}

          {!downloading && !failed && (
            <button
              className='btn btn--primary'
              type='button'
              onClick={() => (ready ? installUpdate() : download())}
            >
              {intl.formatMessage({id: ready ? 'update.restart' : 'update.download'})}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export default UpdatePrompt
