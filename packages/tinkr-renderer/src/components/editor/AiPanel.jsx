import {useEffect, useRef, useState} from 'react'
import {useAtomValue, useSetAtom} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'
import PropTypes from 'prop-types'

import useDocumentId from '../../hooks/useDocumentId'
import {aiAskingAtom, aiThreadAtom, askAiAtom, resolveTurnAtom} from '../../stores/ai'
import {applyCodeAtom} from '../../stores/editor'

/**
 * One exchange: what was asked, what came back, and — when the answer carries
 * code — the snippet it proposes to put in the editor, which is the user's to
 * take or to put aside.
 *
 * The ask is drawn from the moment it is made, so the thread reads as what was
 * said rather than as what has been answered: the answer takes its place under
 * it when it comes.
 */
const Turn = ({turn, onApply, onDiscard}) => {
  const intl = useIntl()

  return (
    <div className='ai__turn'>
      <div className='ai__who'><FormattedMessage id='editor.ai_you'/></div>
      <p className='ai__text'>{turn.prompt}</p>

      <div className='ai__who'><FormattedMessage id='editor.ai'/></div>
      {turn.asking && (
        <p className='ai__asking'><FormattedMessage id='editor.ai_asking'/></p>
      )}
      {turn.text !== '' && (
        <p className={turn.failed ? 'ai__text error' : 'ai__text'}>{turn.text}</p>
      )}

      {turn.code !== null && (
        <>
          <pre className='printed'>{turn.code}</pre>

          <div className='ai__actions'>
            {turn.resolution === null ? (
              <>
                <button
                  className='btn btn--primary btn--sm'
                  type='button'
                  onClick={() => onApply(turn)}
                >
                  {intl.formatMessage({id: 'editor.ai_apply'})}
                </button>
                <button
                  className='btn btn--ghost btn--sm'
                  type='button'
                  onClick={() => onDiscard(turn)}
                >
                  {intl.formatMessage({id: 'editor.ai_discard'})}
                </button>
              </>
            ) : (
              <span className='muted'>
                <FormattedMessage id={turn.resolution === 'applied' ? 'editor.ai_applied' : 'editor.ai_discarded'}/>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

Turn.propTypes = {
  turn: PropTypes.object.isRequired,
  onApply: PropTypes.func.isRequired,
  onDiscard: PropTypes.func.isRequired,
}

/**
 * The panel: the asks this window has made and what came of them, the prompt
 * under them, and the code an answer proposes for the editor to take.
 *
 * The code is read from the document rather than held here, so an ask is about
 * what the editor holds at the moment it is made, and the editor takes a
 * proposal through the store — it is the one that holds the model.
 */
const AiPanel = () => {
  const intl = useIntl()
  const documentId = useDocumentId()
  const thread = useAtomValue(aiThreadAtom)
  const asking = useAtomValue(aiAskingAtom)
  const ask = useSetAtom(askAiAtom)
  const resolve = useSetAtom(resolveTurnAtom)
  const applyCode = useSetAtom(applyCodeAtom)
  const [prompt, setPrompt] = useState('')
  const threadRef = useRef()

  // the newest turn is the one being read
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [thread, asking])

  const send = () => {
    const text = prompt.trim()

    if (text === '' || asking) {
      return
    }

    setPrompt('')
    ask({documentId, prompt: text})
  }

  const handleSubmit = event => {
    event.preventDefault()
    send()
  }

  const handleKeyDown = event => {
    // enter sends, and a new line is what shift-enter is for
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  const handleApply = turn => {
    applyCode({id: documentId, code: turn.code})
    resolve({id: turn.id, resolution: 'applied'})
  }

  const handleDiscard = turn => {
    resolve({id: turn.id, resolution: 'discarded'})
  }

  return (
    <div className='ai'>
      <div className='ai__thread' ref={threadRef}>
        {thread.length === 0 && !asking && (
          <p className='ai__empty'>
            <FormattedMessage id='editor.ai_empty'/>
          </p>
        )}

        {thread.map(turn => (
          <Turn
            key={turn.id}
            turn={turn}
            onApply={handleApply}
            onDiscard={handleDiscard}
          />
        ))}
      </div>

      <form className='ai__ask' aria-busy={asking} onSubmit={handleSubmit}>
        <textarea
          className='textarea'
          rows={2}
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={intl.formatMessage({id: 'editor.ai_placeholder'})}
          aria-label={intl.formatMessage({id: 'editor.ai'})}
          spellCheck={false}
        />

        <button
          className='btn btn--primary'
          type='submit'
          disabled={asking || prompt.trim() === ''}
        >
          <FormattedMessage id='editor.ai_ask'/>
        </button>
      </form>
    </div>
  )
}

export default AiPanel
