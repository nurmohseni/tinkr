import PropTypes from 'prop-types'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue} from 'jotai'
import {useRoute} from 'wouter'

import SnippetItem from './SnippetItem'
import NewSessionButton from './NewSessionButton'
import {snippetListAtom} from '../../stores/snippets'

/**
 * The snippets of the connection, as the sidebar's tree nav lists them. The app
 * keeps no folders, so the rows sit on one level.
 *
 * A connection nothing has been written in has no snippets, and the section says
 * so in one faint line — the same line the list uses for a search that matched
 * nothing, which is a different thing and is worded as one. Its + opens a new
 * session rather than a snippet: only Save, which names what has been typed,
 * writes one.
 */
const SnippetList = ({query}) => {
  const intl = useIntl()
  const snippets = useAtomValue(snippetListAtom)
  const [, params] = useRoute('/snippets/:id/:mode')

  const search = query.trim().toLowerCase()
  const matches = search
    ? snippets.filter(snippet => snippet.name.toLowerCase().includes(search))
    : snippets

  return (
    <nav
      className='sidebar__section'
      aria-label={intl.formatMessage({id: 'editor.snippets'})}
    >
      <div className='sidebar__title'>
        <span>
          <FormattedMessage id='editor.snippets'/>
        </span>
        <NewSessionButton/>
      </div>

      {matches.length === 0 && (
        <div className='tree-nav__row'>
          <span className='faint truncate'>
            {snippets.length === 0
              ? <FormattedMessage id='editor.snippets_empty'/>
              : 'No snippets match'}
          </span>
        </div>
      )}

      {matches.map(snippet => (
        <SnippetItem
          key={snippet.id}
          snippet={snippet}
          active={params?.id === snippet.id}
        />
      ))}
    </nav>
  )
}

SnippetList.propTypes = {
  query: PropTypes.string.isRequired,
}

export default SnippetList
