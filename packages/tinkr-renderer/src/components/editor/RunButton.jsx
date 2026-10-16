import {useCallback} from 'react'
import {useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'
import {useRoute} from 'wouter'
import debounce from 'lodash/debounce'

import {activeSessionAtom, documentAtomWithId} from '../../stores/sessions'
import {runAtom} from '../../stores/editor'
import {configAtom} from '../../stores/config'
import {shortcutLabel} from '../../utils/isMatchShortcut'

/**
 * The screen's one primary control: runs what the well holds — the snippet the
 * route names, or the session the window is on when no snippet is.
 *
 * It says its word and its shortcut: the play glyph, "Run", and the keys that do
 * the same from the editor as a keycap on the fill. It is hidden in form mode,
 * where the form has the run button.
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
      className='btn btn--primary btn--run'
      type='button'
      aria-label={label}
      onClick={() => runDebounced(code)}
      disabled={isDisabled}
      style={isFormMode ? {display: 'none'} : undefined}
    >
      {/* the play the whole world reads as run */}
      <svg width='12' height='12' viewBox='0 0 16 16' aria-hidden='true' fill='currentColor'>
        <path d='M4.8 3.1l7.6 4.9-7.6 4.9z'/>
      </svg>
      {label}
      <span className='keycap keycap--on-primary'>{shortcutLabel(config.shortcut_run)}</span>
    </button>
  )
}

export default RunButton
