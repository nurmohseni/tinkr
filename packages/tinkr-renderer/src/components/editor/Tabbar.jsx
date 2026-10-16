import {useEffect, useRef, useState} from 'react'
import {useAtomValue, useSetAtom} from 'jotai'
import {useIntl} from 'react-intl'

import SnippetNameInput from './SnippetNameInput'
import RunButton from './RunButton'
import DryRunButton from './DryRunButton'
import FormButton from './FormButton'
import SaveSnippetButton from './SaveSnippetButton'
import useNewSession from '../../hooks/useNewSession'
import useOpenDocuments from '../../hooks/useOpenDocuments'
import {updateSnippetAtom} from '../../stores/snippets'
import {closeSessionPromptAtom, snippetMenuAtom} from '../../stores/snippetMenu'
import {runCodeAtom} from '../../stores/editor'
import {configAtom} from '../../stores/config'

const CloseIcon = () => (
  <svg width='8' height='8' viewBox='0 0 8 8' aria-hidden='true'>
    <path d='M1 1l6 6M7 1l-6 6' stroke='currentColor' strokeWidth='1.1' strokeLinecap='round'/>
  </svg>
)

/**
 * The documents open in this window, as pill tabs: the snippets it has been
 * navigated to, and the unsaved sessions it has started, all of them side by
 * side and each with its own code behind it.
 *
 * A session has no name until Save gives it one, so every session's tab reads
 * Unsaved; a snippet's tab reads its name, and the one that is open is where
 * that name is edited. What is open and what is on screen are two different
 * things held in two different places — `useOpenDocuments` knows the first, the
 * route and the active session the second — which is what lets a tab wait
 * behind the window instead of being a record of where it has been.
 *
 * The dot on a tab is the run marker: it appears when the document has been
 * edited since the code it was last run with.
 */
const Tabbar = () => {
  const intl = useIntl()
  const {documents, activeId, activate, close} = useOpenDocuments()
  const startSession = useNewSession()
  const updateSnippet = useSetAtom(updateSnippetAtom)
  const runCode = useAtomValue(runCodeAtom)
  const config = useAtomValue(configAtom)
  const setMenu = useSetAtom(snippetMenuAtom)
  const setClosePrompt = useSetAtom(closeSessionPromptAtom)

  const [runs, setRuns] = useState({})
  const activeRef = useRef(activeId)

  useEffect(() => {
    activeRef.current = activeId
  }, [activeId])

  // a run hands its code to the window, which is what the tab's dot compares to
  useEffect(() => {
    if (runCode && activeRef.current) {
      setRuns(previous => ({...previous, [activeRef.current]: runCode}))
    }
  }, [runCode])

  const unsavedLabel = intl.formatMessage({id: 'editor.unsaved'})
  const newSessionLabel = intl.formatMessage({id: 'editor.new_session'})
  // a log file is a document with nothing behind it but the file, so it is a tab
  // like the others and not a reading of one
  const open = documents.filter(tab => tab.document || tab.isLog)
  const active = open.find(tab => tab.id === activeId) || null

  return (
    <div className='tabbar'>
      <div
        className='tabbar__tabs'
        role='tablist'
        aria-label={intl.formatMessage({id: 'editor.documents'})}
      >
        {open.map(tab => {
          const isOpen = tab.id === activeId
          // a session has a name when a run was opened in it, and Unsaved is
          // what a session the window started itself is called; a log file is
          // called what it is called on the machine it lives on
          const label = tab.isLog
            ? tab.log
            : (tab.isSession ? (tab.document.name || unsavedLabel) : tab.snippet.name)
          const isEdited = !tab.isLog && runs[tab.id] !== undefined && runs[tab.id] !== tab.document.code

          return (
            <div
              key={tab.id}
              className={isOpen ? 'tab tab--active' : 'tab'}
              role='tab'
              aria-selected={isOpen}
              title={label}
              onClick={() => {
                if (!isOpen) {
                  activate(tab.id)
                }
              }}
              onContextMenu={event => {
                // a session has no row in the sidebar to rename or delete, a log
                // file is renamed by the machine that writes it, and the open
                // tab's label is a text field, where a right click is the
                // field's own menu rather than this one
                if (tab.isSession || tab.isLog || event.target.closest('input')) {
                  return
                }

                event.preventDefault()
                setMenu({snippet: tab.snippet, x: event.clientX, y: event.clientY})
              }}
            >
              {isOpen && tab.snippet ? (
                <SnippetNameInput
                  value={label}
                  onChange={name => updateSnippet({id: tab.id, name})}
                />
              ) : (
                <span className={tab.isLog ? 'truncate mono' : 'truncate'}>{label}</span>
              )}

              {isEdited && (
                <span
                  className='tab__dot'
                  title={intl.formatMessage({id: 'editor.edited_since_run'})}
                />
              )}

              <button
                className='tab__close'
                type='button'
                title={`Close ${label}`}
                aria-label={`Close ${label}`}
                onClick={event => {
                  event.stopPropagation()

                  // code that has been typed into a session is written nowhere,
                  // so closing its tab is the one way to lose it, and that is
                  // asked about — unless the question has been answered for good
                  // in the prompt, which the preference holds. A snippet's tab is
                  // a view of the store: closing it closes the view, and the
                  // snippet stays where it is.
                  if (tab.isSession && tab.document.code.trim() && config.confirm_close_session) {
                    setClosePrompt(tab.id)
                    return
                  }

                  close(tab.id)
                }}
              >
                <CloseIcon/>
              </button>
            </div>
          )
        })}
      </div>

      <button
        className='tabbar__new'
        type='button'
        title={newSessionLabel}
        aria-label={newSessionLabel}
        onClick={() => startSession()}
      >
        +
      </button>

      <span className='grow'/>

      <div className='row'>
        {active?.snippet && config.form_switch && <FormButton/>}
        {active?.isSession && <SaveSnippetButton/>}
        {!active?.isLog && (
          <>
            <DryRunButton/>
            <RunButton/>
          </>
        )}
      </div>
    </div>
  )
}

export default Tabbar
