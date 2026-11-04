import {useEffect, useId, useRef, useState} from 'react'
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
import {applyCodeAtom, currentResultAtom} from '../../stores/editor'
import {aiFiles} from '../../utils/api'
import {mentionAt, withMention} from '../../utils/aiMention'
import AiTurn from './AiTurn'

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
 * Under the prompt sits one foot row: the two switches that say what an ask
 * carries with it, and — beside the ask itself — the `@` that names a file of
 * the project for the request to include.
 */
const AiPanel = () => {
  const intl = useIntl()
  const id = useId()
  const documentId = useDocumentId()
  const thread = useAtomValue(aiThreadAtom)
  const asking = useAtomValue(aiAskingAtom)
  const ask = useSetAtom(askAiAtom)
  const resolve = useSetAtom(resolveTurnAtom)
  const applyCode = useSetAtom(applyCodeAtom)
  const result = useAtomValue(currentResultAtom)
  const focus = useAtomValue(aiFocusAtom)
  const [prompt, setPrompt] = useState('')
  const [mention, setMention] = useState(null)
  const [active, setActive] = useState(0)
  const threadRef = useRef()
  const inputRef = useRef()
  const optionRefs = useRef([])
  // whether the thread is being read at its foot, which is what says a new
  // answer may move it: one that moves while the reader is up in what came
  // before cannot be read
  const pinnedRef = useRef(true)

  const listId = `${id}-files`
  const optionId = index => `${id}-file-${index}`
  const files = mention ? mention.files : []

  // the newest turn is the one being read, until the reader goes up
  useEffect(() => {
    const scroller = threadRef.current

    if (scroller && pinnedRef.current) {
      scroller.scrollTop = scroller.scrollHeight
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
      .then(list => {
        if (live) {
          setMention({...found, files: list})
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

  // the list can be longer than the room it has, and the one the arrows are on
  // is the one to keep in view
  useEffect(() => {
    const option = optionRefs.current[active]

    if (mention && option && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({block: 'nearest'})
    }
  }, [active, mention])

  const send = () => {
    const text = prompt.trim()

    if (text === '' || asking) {
      return
    }

    setPrompt('')
    setMention(null)
    // a question is asked from the foot of the thread, so the answer will be
    // looked for there
    pinnedRef.current = true
    ask({documentId, prompt: text, output: result})

    // the ask is the only control that disables itself, so the caret comes back
    // to where the next question is written
    if (inputRef.current) {
      inputRef.current.focus()
    }
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

  const handleThreadScroll = () => {
    const scroller = threadRef.current

    if (!scroller) {
      return
    }

    const room = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

    pinnedRef.current = room < 24
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
      <div
        className='ai__thread'
        ref={threadRef}
        role='log'
        aria-label={intl.formatMessage({id: 'editor.ai'})}
        onScroll={handleThreadScroll}
      >
        {thread.length === 0 && !asking && (
          <p className='ai__empty'>
            <FormattedMessage id='editor.ai_empty'/>
          </p>
        )}

        {thread.map(turn => (
          <AiTurn
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
            <div
              className='autocomplete ai__mention'
              id={files.length > 0 ? listId : undefined}
              role={files.length > 0 ? 'listbox' : undefined}
              aria-label={files.length > 0 ? intl.formatMessage({id: 'editor.ai_mention'}) : undefined}
            >
              {files.length === 0 ? (
                <div className='autocomplete__item'>
                  <span className='faint'>
                    <FormattedMessage id='editor.ai_mention_empty'/>
                  </span>
                </div>
              ) : files.map((file, index) => (
                <button
                  key={file.qualified}
                  id={optionId(index)}
                  ref={node => {
                    optionRefs.current[index] = node
                  }}
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
            // the list the `@` opens is the prompt's own suggestion list: the
            // caret stays in the field and the arrows name the row they are on
            aria-autocomplete='list'
            aria-haspopup='listbox'
            aria-controls={files.length > 0 ? listId : undefined}
            aria-activedescendant={files.length > 0 ? optionId(active) : undefined}
            spellCheck={false}
          />
        </div>

        <div className='ai__foot'>
          <div className='ai__context'>
            <span className='ai__context-label'>
              <FormattedMessage id='editor.ai_send_with'/>
            </span>

            <ContextSwitch labelId='editor.ai_send_code' contextKey='code'/>
            <ContextSwitch labelId='editor.ai_send_output' contextKey='output'/>
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
        </div>
      </form>
    </div>
  )
}

export default AiPanel
