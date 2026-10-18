import {atom, useAtomValue} from 'jotai'
import {useIntl} from 'react-intl'
import {useRoute} from 'wouter'

import Outcome from './Outcome'
import {connectionAtom, resultAtom} from '../stores/editor'
import {phpVersionAtom} from '../stores/php'
import {configAtom} from '../stores/config'
import {snippetAtomWithId} from '../stores/snippets'
import appVersion from '../utils/appVersion'

// the status bar is mounted above the router, so on the root route there is no
// snippet to read a caret position from
const noSnippetAtom = atom(null)

/**
 * The app's bottom strip.
 *
 * It prints what the app knows: the connection this window was opened with,
 * where the caret is in the open snippet, whether the AI completions are on,
 * and the version. Run time, memory and the PHP version are shown by the
 * design but nothing in the app measures them, so they are left out.
 *
 * A run that threw is the outcome glyph and its class, in the error ink: the
 * strip says what happened where the eye already is, in the language the rest
 * of the app says it in.
 */
const Statusbar = () => {
  const intl = useIntl()
  const connection = useAtomValue(connectionAtom)
  const php = useAtomValue(phpVersionAtom)
  const config = useAtomValue(configAtom)
  const result = useAtomValue(resultAtom)
  const [, params] = useRoute('/snippets/:id/:mode')
  const snippet = useAtomValue(params?.id ? snippetAtomWithId(params.id) : noSnippetAtom)
  const position = snippet?.position

  return (
    <footer className='statusbar'>
      {result && result.error && (
        <span className='statusbar__item error'>
          <Outcome kind='threw'/>
          {intl.formatMessage({id: 'statusbar.run_failed'}, {class: result.error.class})}
        </span>
      )}
      {connection.name && (
        <span className='statusbar__item'>
          <span className='dot dot--live'/>
          {intl.formatMessage({id: 'statusbar.connected'}, {
            name: connection.name,
            kind: intl.formatMessage({
              id: connection.tag === 'production'
                ? 'connections.kind_production'
                : (connection.is_over_ssh ? 'connections.kind_ssh' : 'connections.kind_local'),
            }),
          })}
        </span>
      )}

      {php.status === 'found' && (
        <span className='statusbar__item mono'>
          {intl.formatMessage({id: 'statusbar.php'}, {version: php.version})}
        </span>
      )}

      {position && (
        <span className='statusbar__item'>
          {intl.formatMessage({id: 'statusbar.caret'}, {line: position.lineNumber, column: position.column})}
        </span>
      )}

      <span className='grow'/>

      <span className='statusbar__item faint'>
        {intl.formatMessage({id: 'statusbar.autocomplete'}, {
          state: intl.formatMessage({id: config.ai_model && config.ai_autocomplete ? 'statusbar.on' : 'statusbar.off'}),
        })}
      </span>
      <span className='statusbar__item faint'>Tinkr {appVersion}</span>
    </footer>
  )
}

export default Statusbar
