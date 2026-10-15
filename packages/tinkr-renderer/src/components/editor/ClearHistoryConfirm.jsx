import {createPortal} from 'react-dom'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtom, useSetAtom} from 'jotai'

import {clearHistoryAtom, clearHistoryPromptAtom} from '../../stores/history'

/**
 * The confirmation the bin in the History header raises, as the design's narrow
 * modal, portalled to the body like the other confirms.
 *
 * Clearing is the one thing that loses runs for good — a connection keeps fifty
 * of them — so it is asked about the way dropping a snippet or a connection is.
 */
const ClearHistoryConfirm = () => {
  const [asking, setAsking] = useAtom(clearHistoryPromptAtom)
  const clear = useSetAtom(clearHistoryAtom)
  const intl = useIntl()

  const hide = () => setAsking(false)

  if (!asking) {
    return null
  }

  return createPortal(
    <div className='modal-overlay'>
      <div
        className='modal modal--narrow'
        role='dialog'
        aria-modal='true'
        aria-labelledby='clear-history-title'
      >
        <header
          className='modal__header'
          id='clear-history-title'
        >
          {intl.formatMessage({id: 'editor.history_clear_title'})}
        </header>

        <div className='modal__body'>
          <FormattedMessage id='editor.history_clear_content'/>
        </div>

        <footer className='modal__footer'>
          <button
            className='btn btn--ghost'
            type='button'
            onClick={hide}
          >
            {intl.formatMessage({id: 'cancel'})}
          </button>

          <button
            className='btn btn--primary'
            type='button'
            onClick={clear}
          >
            {intl.formatMessage({id: 'editor.history_clear'})}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export default ClearHistoryConfirm
