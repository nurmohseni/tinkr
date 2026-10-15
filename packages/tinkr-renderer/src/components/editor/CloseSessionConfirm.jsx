import {useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtom, useSetAtom} from 'jotai'

import useOpenDocuments from '../../hooks/useOpenDocuments'
import {setConfigAtom} from '../../stores/config'
import {closeSessionPromptAtom, saveSnippetPromptAtom} from '../../stores/snippetMenu'

/**
 * What closing a session's tab asks when that session has been typed in, as the
 * design's narrow modal — the same shape as the app's other confirmations.
 *
 * Nothing of a session is written anywhere, so closing its tab is the one way to
 * lose the code in it: the question is asked rather than the code dropped, and
 * it offers the way out too — naming the session as a snippet keeps the code and
 * turns its tab into that snippet's. Cancelling leaves the session, its tab and
 * the window exactly as they are. A session with nothing in it asks nothing, and
 * a snippet's tab is never asked about at all: closing one closes a view of the
 * store, and the snippet stays in the sidebar.
 *
 * The box under the text is the standing answer to the same question: a session
 * that has been closed with it ticked stops raising this prompt, and the
 * preference it writes is what Settings shows and what the tab bar reads. It is
 * only the two answers that *close* the session that can remember anything —
 * cancel closed nothing, so it writes nothing, and what was ticked then is not
 * remembered either.
 */
const CloseSessionConfirm = () => {
  const intl = useIntl()
  const [sessionId, setSessionId] = useAtom(closeSessionPromptAtom)
  const [, setSavingId] = useAtom(saveSnippetPromptAtom)
  const setConfig = useSetAtom(setConfigAtom)
  const [remember, setRemember] = useState(false)
  const {close} = useOpenDocuments()

  // every opening starts unticked, since nothing has been decided about this one
  // yet, whatever the last one was told
  useEffect(() => {
    if (sessionId) {
      setRemember(false)
    }
  }, [sessionId])

  if (!sessionId) {
    return null
  }

  // the two answers that end the session, and with it the code it held, are the
  // ones that can remember the question
  const rememberChoice = () => {
    if (remember) {
      setConfig({confirm_close_session: false})
    }
  }

  return createPortal(
    <div className='modal-overlay'>
      <div
        className='modal modal--narrow close-session'
        role='dialog'
        aria-modal='true'
        aria-labelledby='close-session-title'
      >
        <header
          className='modal__header'
          id='close-session-title'
        >
          {intl.formatMessage({id: 'editor.close_session_title'})}
        </header>

        <div className='modal__body'>
          <FormattedMessage id='editor.close_session_content'/>

          <label className='checkbox'>
            <input
              type='checkbox'
              checked={remember}
              onChange={event => setRemember(event.target.checked)}
            />
            <span className='checkbox__box'/>
            {intl.formatMessage({id: 'editor.close_session_dont_ask'})}
          </label>
        </div>

        <footer className='modal__footer'>
          <button
            className='btn btn--ghost'
            type='button'
            onClick={() => setSessionId(null)}
          >
            {intl.formatMessage({id: 'cancel'})}
          </button>

          <button
            className='btn btn--secondary'
            type='button'
            onClick={() => {
              setSessionId(null)
              rememberChoice()
              close(sessionId)
            }}
          >
            {intl.formatMessage({id: 'discard'})}
          </button>

          <button
            className='btn btn--primary'
            type='button'
            onClick={() => {
              setSessionId(null)
              rememberChoice()
              setSavingId(sessionId)
            }}
          >
            {intl.formatMessage({id: 'editor.save_snippet'})}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export default CloseSessionConfirm
