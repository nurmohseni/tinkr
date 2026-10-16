import {createPortal} from 'react-dom'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtom, useSetAtom} from 'jotai'

import useOpenDocuments from '../../hooks/useOpenDocuments'
import {deleteSnippetAtom} from '../../stores/snippets'
import {deleteSnippetPromptAtom} from '../../stores/snippetMenu'

/**
 * The confirmation the snippet menu raises before a snippet is dropped, as the
 * design's narrow modal.
 *
 * It is portalled to the body, like the dialog it replaces: the list that opens
 * it scrolls, and a modal belongs over the whole window. Nothing closes it but
 * its own two buttons — the dialog the app used before had no onClose either.
 *
 * Dropping the snippet closes the tab it had with it, and the window moves on
 * the way it moves when any tab is closed: to the next one along, or to a
 * session of its own when the snippet was the last thing open. The snippet is
 * the store's, so the sidebar loses it too, whatever the tab bar then shows.
 */
const DeleteSnippetConfirm = () => {
  const [snippet, setSnippet] = useAtom(deleteSnippetPromptAtom)
  const intl = useIntl()
  const {close} = useOpenDocuments()
  const deleteSnippet = useSetAtom(deleteSnippetAtom)

  const confirm = () => {
    if (snippet) {
      deleteSnippet(snippet.id)
      close(snippet.id)
    }

    setSnippet(null)
  }

  const hide = () => setSnippet(null)

  if (!snippet) {
    return null
  }

  return createPortal(
    <div className='modal-overlay'>
      <div
        className='modal modal--narrow'
        role='dialog'
        aria-modal='true'
        aria-labelledby='delete-snippet-title'
      >
        <header
          className='modal__header'
          id='delete-snippet-title'
        >
          {intl.formatMessage({id: 'editor.delete_confirm_title'})}
        </header>

        <div className='modal__body'>
          <FormattedMessage
            id='editor.delete_confirm_content'
            values={{
              name: snippet.name,
              // eslint-disable-next-line react/display-name
              strong: chucks => <strong>{chucks}</strong>,
            }}
          />
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
            className='btn btn--danger'
            type='button'
            onClick={confirm}
          >
            {intl.formatMessage({id: 'editor.delete_snippet'})}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export default DeleteSnippetConfirm
