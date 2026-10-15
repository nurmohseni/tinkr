import PropTypes from 'prop-types'
import {useSetAtom} from 'jotai'
import {useLocation} from 'wouter'

import {snippetMenuAtom} from '../../stores/snippetMenu'

/**
 * One snippet in the sidebar: a row that opens it, and the snippet menu on
 * right click, at the pointer.
 */
const SnippetItem = ({snippet, active}) => {
  const [, setLocation] = useLocation()
  const setMenu = useSetAtom(snippetMenuAtom)

  return (
    <button
      className={active ? 'tree-nav__row tree-nav__row--active' : 'tree-nav__row'}
      type='button'
      title={snippet.name}
      aria-current={active ? 'true' : undefined}
      onClick={() => setLocation(`/snippets/${snippet.id}/editor`)}
      onContextMenu={event => {
        event.preventDefault()
        setMenu({snippet, x: event.clientX, y: event.clientY})
      }}
    >
      <span className='tree-nav__caret'/>
      <span className='truncate mono' style={{fontSize: 'var(--fs-sm)'}}>{snippet.name}</span>
    </button>
  )
}

SnippetItem.propTypes = {
  snippet: PropTypes.object.isRequired,
  active: PropTypes.bool.isRequired,
}

export default SnippetItem
