import {useCallback, useEffect, useState} from 'react'
import {useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'
import {useRoute} from 'wouter'
import debounce from 'lodash/debounce'

import {activeSessionAtom, documentAtomWithId} from '../../stores/sessions'
import {runAtom, runStartedAtAtom, runningAtom, stopRunAtom} from '../../stores/editor'
import {configAtom} from '../../stores/config'
import {shortcutLabel} from '../../utils/isMatchShortcut'

/**
 * The screen's one primary control: runs what the well holds — the snippet the
 * route names, or the session the window is on when no snippet is.
 *
 * While a run is going it is the other thing the screen needs: a stop. A run is
 * a session of its own, and stopping it ends that session, which is what reaches
 * the php doing the work — inside a container or on a server as much as here. The
 * same button, because a run that is going cannot be run again: the second one
 * would replace the first, and the answer nobody is waiting for would still be
 * work somebody asked for.
 *
 * It says its word and its shortcut as a keycap on the fill, and the stop carries
 * the key the terminal itself uses for one.
 *
 * While the run is going the button also counts the wait, from the moment the
 * run was sent: a run that is taking longer than it should is something to
 * see, and the count is the same one the result reports when the answer comes.
 */
const RunButton = () => {
  const intl = useIntl()
  const [, params] = useRoute('/snippets/:id/:mode')
  const [isFormMode] = useRoute('/snippets/:id/form')
  const session = useAtomValue(activeSessionAtom)
  const documentId = params?.id || session?.id
  const document = useAtomValue(documentAtomWithId(documentId))
  const config = useAtomValue(configAtom)
  const run = useSetAtom(runAtom)
  const running = useAtomValue(runningAtom)
  const startedAt = useAtomValue(runStartedAtAtom)
  const stop = useSetAtom(stopRunAtom)
  const [now, setNow] = useState(() => Date.now())

  // a second is the unit the count is shown in, so a tick a second is enough
  useEffect(() => {
    if (!running) {
      return undefined
    }

    setNow(Date.now())

    const tick = setInterval(() => setNow(Date.now()), 250)

    return () => clearInterval(tick)
  }, [running, startedAt])

  const elapsed = running && startedAt ? Math.max(0, now - startedAt) : 0
  const seconds = (elapsed / 1000).toFixed(elapsed < 10000 ? 1 : 0)

  const code = document?.code || ''
  // a stop is always available: the code that is running is not the code in the
  // well any more where the well was emptied while it ran
  const isDisabled = !running && code.trim() === ''

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runDebounced = useCallback(debounce(value => run(value, {document: documentId}), 500), [documentId])

  const label = intl.formatMessage({id: running ? 'editor.stop' : 'editor.run'})

  return (
    <button
      className={running ? 'btn btn--danger btn--run' : 'btn btn--primary btn--run'}
      type='button'
      aria-label={label}
      onClick={running ? stop : () => runDebounced(code)}
      disabled={isDisabled}
      style={isFormMode ? {display: 'none'} : undefined}
    >
      {running ? (
        /* the square every editor uses for stop */
        <svg width='12' height='12' viewBox='0 0 16 16' aria-hidden='true' fill='currentColor'>
          <rect x='4' y='4' width='8' height='8' rx='1.2'/>
        </svg>
      ) : (
        /* the play the whole world reads as run */
        <svg width='12' height='12' viewBox='0 0 16 16' aria-hidden='true' fill='currentColor'>
          <path d='M4.8 3.1l7.6 4.9-7.6 4.9z'/>
        </svg>
      )}
      {label}
      {running && (
        <span className='btn__timer mono'>
          {intl.formatMessage({id: 'result.duration'}, {seconds})}
        </span>
      )}
      <span className='keycap keycap--on-primary'>{shortcutLabel(config.shortcut_run)}</span>
    </button>
  )
}

export default RunButton
