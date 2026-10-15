import {useCallback} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'
import {useRoute} from 'wouter'
import debounce from 'lodash/debounce'

import ShortcutKeys from './ShortcutKeys'
import {activeSessionAtom, documentAtomWithId} from '../../stores/sessions'
import {runAtom} from '../../stores/editor'
import {configAtom} from '../../stores/config'

/**
 * The screen's one gradient control: runs what the well holds — the snippet the
 * route names, or the session the window is on when no snippet is — and carries
 * the shortcut that does the same from the editor.
 *
 * It is hidden in form mode, where the form has the run button.
 */
const RunButton = () => {
  const intl = useIntl()
  const [, params] = useRoute('/snippets/:id/:mode')
  const [isFormMode] = useRoute('/snippets/:id/form')
  const session = useAtomValue(activeSessionAtom)
  const document = useAtomValue(documentAtomWithId(params?.id || session?.id))
  const config = useAtomValue(configAtom)
  const run = useSetAtom(runAtom)

  const code = document?.code || ''
  const isDisabled = code.trim() === ''

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runDebounced = useCallback(debounce(value => run(value), 500), [])

  const label = intl.formatMessage({id: 'editor.run'})

  return (
    <button
      className='btn btn--primary'
      type='button'
      title={label}
      onClick={() => runDebounced(code)}
      disabled={isDisabled}
      style={isFormMode ? {display: 'none'} : undefined}
    >
      <FormattedMessage id='editor.run'/>
      <ShortcutKeys keys={config.shortcut_run}/>
    </button>
  )
}

export default RunButton
