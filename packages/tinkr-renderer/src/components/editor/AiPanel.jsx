import {useEffect, useRef, useState} from 'react'
import {useAtomValue, useSetAtom} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'
import PropTypes from 'prop-types'

import useDocumentId from '../../hooks/useDocumentId'
import {
  aiAskingAtom,
  aiContextAtom,
  aiFocusAtom,
  aiThreadAtom,
  askAiAtom,
  resolveTurnAtom,
  toggleAiContextAtom,
} from '../../stores/ai'
import {applyCodeAtom, resultAtom} from '../../stores/editor'
import {aiFiles} from '../../utils/api'
import {mentionAt, withMention} from '../../utils/aiMention'

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
 * One of the two switches under the prompt: whether an ask carries the code the
 * editor holds, or the answer the last run gave. Both are about this window's
 * conversation, so neither is a preference of the app's.
 */
const ContextSwitch = ({labelId, contextKey}) => {
  const intl = useIntl()
  const context = useAtomValue(aiContextAtom)
  const toggle = useSetAtom(toggleAiContextAtom)
  const label = intl.formatMessage({id: labelId})

  return (
    <label className='checkbox'>
      <input
        type='checkbox'
        checked={context[contextKey]}
        aria-label={label}
        onChange={() => toggle(contextKey)}
      />
      <span className='checkbox__box'/>
      {label}
    </label>
  )
}

ContextSwitch.propTypes = {
  labelId: PropTypes.string.isRequired,
  contextKey: PropTypes.string.isRequired,
}

/**
 * The panel: the asks this window has made and what came of them, the prompt
 * under them, and the code an answer proposes for the editor to take.
 *
 * The code is read from the document rather than held here, so an ask is about
 * what the editor holds at the moment it is made, and the editor takes a
 * proposal through the store — it is the one that holds the model.
 *
 * Under the prompt sit the two switches that say what an ask carries with it,
 * and the `@` that names a file of the project for the request to include.
 */
const AiPanel = () => {
  const intl = useIntl()
  const documentId = useDocumentId()
  const thread = useAtomValue(aiThreadAtom)
  const asking = useAtomValue(aiAskingAtom)
  const ask = useSetAtom(askAiAtom)
  const resolve = useSetAtom(resolveTurnAtom)
  const applyCode = useSetAtom(applyCodeAtom)
  const result = useAtomValue(resultAtom)
  const focus = useAtomValue(aiFocusAtom)
  const [prompt, setPrompt] = useState('')
  const [mention, setMention] = useState(null)
  const [active, setActive] = useState(0)
  const threadRef = useRef()
  const inputRef = useRef()

  // the newest turn is the one being read
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [thread, asking])

  // the shortcut opened the panel for the prompt, so the cursor goes there: the
  // count is what says it was asked for again
  useEffect(() => {
    if (focus > 0 && inputRef.current) {
      inputRef.current.focus()
    }
  }, [focus])

  // what the `@` being written could name
  useEffect(() => {
    const found = mentionAt(prompt)

    if (!found) {
      setMention(null)

      return undefined
    }

    let live = true

    aiFiles(found.typed)
      .then(files => {
        if (live) {
          setMention({...found, files})
          setActive(0)
        }
      })
      .catch(() => {
        if (live) {
          setMention(null)
        }
      })

    return () => {
      live = false
    }
  }, [prompt])

  const send = () => {
    const text = prompt.trim()

    if (text === '' || asking) {
      return
    }

    setPrompt('')
    setMention(null)
    ask({documentId, prompt: text, output: result})
  }

  const handleSubmit = event => {
    event.preventDefault()
    send()
  }

  const pick = file => {
    if (!mention) {
      return
    }

    setPrompt(withMention(prompt, mention, file))
    setMention(null)

    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  const reference = () => {
    const space = prompt === '' || /\s$/.test(prompt) ? '' : ' '

    setPrompt(`${prompt}${space}@`)

    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  const handleKeyDown = event => {
    const files = mention ? mention.files : []

    if (files.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive(at => Math.min(at + 1, files.length - 1))

        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive(at => Math.max(at - 1, 0))

        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pick(files[active])

        return
      }
    }

    if (mention && event.key === 'Escape') {
      event.preventDefault()
      setMention(null)

      return
    }

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
        <div className='ai__field'>
          {mention && (
            <div className='autocomplete ai__mention' role='listbox'>
              {mention.files.length === 0 ? (
                <div className='autocomplete__item'>
                  <span className='faint'>
                    <FormattedMessage id='editor.ai_mention_empty'/>
                  </span>
                </div>
              ) : mention.files.map((file, index) => (
                <button
                  key={file.qualified}
                  className={index === active ? 'autocomplete__item autocomplete__item--active' : 'autocomplete__item'}
                  type='button'
                  role='option'
                  aria-selected={index === active}
                  // the pointer must not take the focus out of the prompt: a click
                  // is a click on the row, and the caret stays where it was
                  onMouseDown={event => {
                    event.preventDefault()
                    pick(file)
                  }}
                >
                  <span className='autocomplete__kind'>{file.name}</span>
                  <span className='faint truncate'>{file.path}</span>
                </button>
              ))}
            </div>
          )}

          <textarea
            className='textarea'
            rows={2}
            ref={inputRef}
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={intl.formatMessage({id: 'editor.ai_placeholder'})}
            aria-label={intl.formatMessage({id: 'editor.ai'})}
            spellCheck={false}
          />
        </div>

        <div className='ai__send'>
          <button
            className='btn btn--secondary'
            type='button'
            title={intl.formatMessage({id: 'editor.ai_mention'})}
            aria-label={intl.formatMessage({id: 'editor.ai_mention'})}
            onClick={reference}
          >
            @
          </button>

          <button
            className='btn btn--primary'
            type='submit'
            disabled={asking || prompt.trim() === ''}
          >
            <FormattedMessage id='editor.ai_ask'/>
          </button>
        </div>
      </form>

      <div className='ai__context'>
        <span className='ai__context-label'>
          <FormattedMessage id='editor.ai_send_with'/>
        </span>

        <ContextSwitch labelId='editor.ai_send_code' contextKey='code'/>
        <ContextSwitch labelId='editor.ai_send_output' contextKey='output'/>
      </div>
    </div>
  )
}

export default AiPanel
