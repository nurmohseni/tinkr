import PropTypes from 'prop-types'
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtom, useAtomValue, useSetAtom} from 'jotai'

import SnippetNameDialog from './SnippetNameDialog'
import CloseSessionConfirm from './CloseSessionConfirm'
import useCreateSnippet from '../../hooks/useCreateSnippet'
import {updateSnippetAtom} from '../../stores/snippets'
import {removeSessionAtom, sessionsAtom} from '../../stores/sessions'
import {replaceTabAtom} from '../../stores/tabs'
import {
  deleteSnippetPromptAtom,
  renameSnippetAtom,
  saveSnippetPromptAtom,
  snippetMenuAtom,
} from '../../stores/snippetMenu'

// the gap a menu keeps from the window's edge when it is pulled back inside it
const menuMargin = 4

/**
 * The snippet menu, at the pointer: the two things the app does to a snippet
 * besides opening it.
 *
 * The app draws it itself rather than raising an Electron menu, which is what
 * it did before: that menu was the main process's, so it could sit behind the
 * window, and it could only ever offer Delete. Both entries go through the rest
 * of the window: Rename asks for a name, Delete asks whether to go ahead.
 */
const SnippetMenu = ({menu, onRename, onDelete, onClose}) => {
  const ref = useRef()
  const [at, setAt] = useState({left: menu.x, top: menu.y})

  // a menu opened at the window's edge is pulled back inside it, so the whole
  // of it is on screen whichever way the pointer sits
  useLayoutEffect(() => {
    const {width, height} = ref.current.getBoundingClientRect()

    setAt({
      left: Math.max(menuMargin, Math.min(menu.x, window.innerWidth - width - menuMargin)),
      top: Math.max(menuMargin, Math.min(menu.y, window.innerHeight - height - menuMargin)),
    })
  }, [menu.x, menu.y])

  useEffect(() => {
    const onPointerDown = event => {
      // pressing an entry is not leaving the menu: the entry itself answers
      if (!ref.current.contains(event.target)) {
        onClose()
      }
    }

    const onKeyDown = event => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    // the menu is anchored to the pointer, so everything that moves what is
    // under it takes it away: a press elsewhere, Escape, a scroll anywhere in
    // the window — the sidebar, the editor, the output all scroll — and the
    // window losing focus
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('blur', onClose)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      className='autocomplete snippet-menu'
      ref={ref}
      role='menu'
      aria-label={menu.snippet.name}
      style={{left: at.left, top: at.top}}
    >
      <button
        className='autocomplete__item'
        type='button'
        role='menuitem'
        onClick={onRename}
      >
        <FormattedMessage id='editor.rename_snippet'/>
      </button>

      <button
        className='autocomplete__item'
        type='button'
        role='menuitem'
        onClick={onDelete}
      >
        <FormattedMessage id='delete'/>
      </button>
    </div>,
    document.body,
  )
}

SnippetMenu.propTypes = {
  menu: PropTypes.shape({
    snippet: PropTypes.object.isRequired,
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }).isRequired,
  onRename: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
}

/**
 * The in-app snippet menu and the window's prompts, where each is raised.
 *
 * The menu follows the pointer wherever it was raised — a snippet's row or its
 * tab — and the prompts are the window's modals: the save one names the session
 * it was raised on, the rename one renames a snippet, and the close one asks
 * about a session whose tab is being closed, with Save as snippet handing the
 * session straight to the save prompt. It is mounted once, in the editor window,
 * above everything it acts on; the confirmation behind Delete sits beside it,
 * next to the window's other dialogs.
 */
const SnippetActions = () => {
  const intl = useIntl()
  const [menu, setMenu] = useAtom(snippetMenuAtom)
  const [rename, setRename] = useAtom(renameSnippetAtom)
  const [savingId, setSavingId] = useAtom(saveSnippetPromptAtom)
  const sessions = useAtomValue(sessionsAtom)
  const setDelete = useSetAtom(deleteSnippetPromptAtom)
  const updateSnippet = useSetAtom(updateSnippetAtom)
  const removeSession = useSetAtom(removeSessionAtom)
  const replaceTab = useSetAtom(replaceTabAtom)
  const createSnippet = useCreateSnippet()

  const closeMenu = useCallback(() => setMenu(null), [setMenu])
  const saving = sessions.find(session => session.id === savingId) || null

  return (
    <>
      {menu && (
        <SnippetMenu
          menu={menu}
          onClose={closeMenu}
          onRename={() => {
            closeMenu()
            setRename({id: menu.snippet.id, name: menu.snippet.name})
          }}
          onDelete={() => {
            closeMenu()
            setDelete(menu.snippet)
          }}
        />
      )}

      <SnippetNameDialog
        isOpen={Boolean(rename)}
        title={intl.formatMessage({id: 'editor.rename_snippet'})}
        label={intl.formatMessage({id: 'editor.snippet_name'})}
        defaultValue={rename?.name}
        confirmLabel={intl.formatMessage({id: 'rename'})}
        onCancel={() => setRename(null)}
        onConfirm={name => {
          // the row and the tab both read the store, so the one write names the
          // snippet everywhere it appears
          updateSnippet({id: rename.id, name})
          setRename(null)
        }}
      />

      <SnippetNameDialog
        isOpen={Boolean(saving)}
        title={intl.formatMessage({id: 'editor.save_snippet'})}
        label={intl.formatMessage({id: 'editor.snippet_name'})}
        defaultValue={intl.formatMessage({id: 'editor.new_snippet'})}
        confirmLabel={intl.formatMessage({id: 'save'})}
        onCancel={() => setSavingId(null)}
        onConfirm={name => {
          setSavingId(null)

          // what was typed becomes the snippet, and the tab that session had
          // becomes the snippet's: this is the one way a session ends without
          // closing it, and it is the only thing that names one
          const created = createSnippet({name, code: saving.code, position: saving.position})

          replaceTab({from: saving.id, to: created.id})
          removeSession(saving.id)
        }}
      />

      <CloseSessionConfirm/>
    </>
  )
}

export default SnippetActions
