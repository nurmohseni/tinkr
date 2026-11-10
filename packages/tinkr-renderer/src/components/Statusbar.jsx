import {useEffect} from 'react'
import {atom, useAtomValue, useSetAtom} from 'jotai'
import {useIntl} from 'react-intl'
import {useRoute} from 'wouter'

import Outcome from './Outcome'
import {connectionAtom, currentResultAtom} from '../stores/editor'
import {phpVersionAtom} from '../stores/php'
import {intelAtom, intelStatusAtom, refreshIntelAtom} from '../stores/intel'
import {configAtom} from '../stores/config'
import {snippetAtomWithId} from '../stores/snippets'
import appVersion from '../utils/appVersion'
import kindOf from '../utils/connectionKind'
import {statsLine} from '../utils/runFacts'

// the status bar is mounted above the router, so on the root route there is no
// snippet to read a caret position from
const noSnippetAtom = atom(null)

// how long ago the project was read: the strip is not a clock, so a minute is the
// finest it says
const ageText = (intl, at) => {
  if (!at) {
    return null
  }

  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000))

  if (minutes < 1) {
    return intl.formatMessage({id: 'statusbar.intel_now'})
  }

  if (minutes < 60) {
    return intl.formatMessage({id: 'statusbar.intel_minutes'}, {count: minutes})
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return intl.formatMessage({id: 'statusbar.intel_hours'}, {count: hours})
  }

  return intl.formatMessage({id: 'statusbar.intel_days'}, {count: Math.floor(hours / 24)})
}

// what has been read of the project, in one line: the state, and when there is a
// read, how big it is and how old
const intelText = (intl, intel) => {
  const age = ageText(intl, intel.at)
  const counts = intel.counts

  if (intel.state === 'reading') {
    return intl.formatMessage({id: 'statusbar.intel_reading'})
  }

  if (intel.state === 'failed') {
    return intl.formatMessage({id: 'statusbar.intel_failed'})
  }

  if (intel.state === 'ready' && counts) {
    return intl.formatMessage({id: 'statusbar.intel_ready'}, {
      models: counts.models,
      keys: counts.config,
      age,
    })
  }

  return intl.formatMessage({id: 'statusbar.intel_none'})
}

/**
 * The app's bottom strip.
 *
 * It prints what the app knows: the connection this window was opened with,
 * where the caret is in the open snippet, what has been read of the project and
 * how long ago, whether the AI completions are on, what the last run spent, and
 * the version. The run's time and memory are measured inside php (see
 * runResult's STATS_ARM) rather than guessed at here, so they are the snippet's
 * own and not the window's.
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
  const result = useAtomValue(currentResultAtom)
  const intel = useAtomValue(intelAtom)
  const loadIntel = useSetAtom(intelStatusAtom)
  const refresh = useSetAtom(refreshIntelAtom)
  const [, params] = useRoute('/snippets/:id/:mode')
  const snippet = useAtomValue(params?.id ? snippetAtomWithId(params.id) : noSnippetAtom)
  const position = snippet?.position
  const spent = result ? statsLine(intl, result.stats) : null

  // the read is the connection's, and a run refreshes it in the main process: the
  // strip follows both, asking about what is held rather than asking the project
  useEffect(() => {
    loadIntel()
  }, [connection.id, result, loadIntel])

  // a read that is still going is asked about until it answers; nothing else polls
  useEffect(() => {
    if (intel.state !== 'reading') {
      return undefined
    }

    const timer = setTimeout(loadIntel, 1000)

    return () => clearTimeout(timer)
  }, [intel, loadIntel])

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
            kind: intl.formatMessage({id: kindOf(connection)}),
          })}
        </span>
      )}

      {php.status === 'found' && (
        <span className='statusbar__item mono'>
          {intl.formatMessage({id: 'statusbar.php'}, {version: php.version})}
        </span>
      )}

      {/* the project read behind the completions: what it holds, and how old it
          is; clicking reads it again without waiting for the watcher */}
      <button
        type='button'
        className={`statusbar__item statusbar__item--action ${intel.state === 'failed' ? 'error' : 'faint'}`}
        title={intl.formatMessage({id: 'statusbar.intel_hint'})}
        onClick={refresh}
      >
        {intelText(intl, intel)}
      </button>

      {spent !== null && (
        <span className='statusbar__item mono'>{spent}</span>
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
