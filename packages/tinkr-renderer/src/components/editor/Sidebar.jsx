import {useEffect, useRef, useState} from 'react'
import {useIntl} from 'react-intl'

import ConnectionSwitcher from './ConnectionSwitcher'
import SnippetList from './SnippetList'
import HistoryList from './HistoryList'
import appVersion from '../../utils/appVersion'

const isMac = () => /Mac/i.test(navigator.platform || navigator.userAgent)

// ctrl+k is monaco's chord key and the terminal's clear key, so the search row
// only takes it when the caret is not inside either
const isTyping = target => ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
  target.isContentEditable ||
  Boolean(target.closest?.('.monaco-editor, .xterm'))

/**
 * The app's sidebar: search, the connections, the snippets, the runs of the
 * connection, and the footer.
 *
 * The design's folder tree is not here, because the app keeps the snippets of a
 * connection in one flat list, and what it keeps of a run is its code: the
 * History section lists the runs themselves.
 */
const Sidebar = () => {
  const intl = useIntl()
  const [query, setQuery] = useState('')
  const searchRef = useRef()

  useEffect(() => {
    const onKeyDown = event => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || isTyping(event.target)) {
        return
      }

      event.preventDefault()
      searchRef.current.focus()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <aside className='sidebar'>
      <div className='sidebar__section'>
        <label className='search'>
          <svg
            width='13'
            height='13'
            viewBox='0 0 16 16'
            aria-hidden='true'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.3'
          >
            <circle cx='7' cy='7' r='4.4'/>
            <path d='M10.4 10.4L14 14' strokeLinecap='round'/>
          </svg>

          <input
            ref={searchRef}
            type='search'
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={intl.formatMessage({id: 'editor.search'})}
            aria-label={intl.formatMessage({id: 'editor.search'})}
            title={intl.formatMessage({id: 'editor.search_keys'}, {keys: isMac() ? '⌘' : 'Ctrl'})}
            spellCheck={false}
          />

          <span className='search__keys'>
            <kbd className='keycap'>{isMac() ? '⌘' : 'Ctrl'}</kbd>
            <kbd className='keycap'>K</kbd>
          </span>
        </label>
      </div>

      <div className='sidebar__scroll'>
        <ConnectionSwitcher/>
        <SnippetList query={query}/>

        <HistoryList/>

      </div>

      <div className='sidebar__section' style={{paddingBottom: 'var(--s2)'}}>
        <div className='tree-nav__row' title={`Tinkr ${appVersion}`}>
          <span className='faint' style={{fontSize: 'var(--fs-xs)'}}>Tinkr {appVersion}</span>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
