import {useIntl} from 'react-intl'
import {useRef} from 'react'
import {useAtomValue, useSetAtom} from 'jotai'

import {configAtom, setConfigAtom} from '../../stores/config'

/** The range a delay can be set to, in milliseconds. */
const MIN = 0
const MAX = 5000

/**
 * How long the editor waits after the last keystroke before it asks for a
 * suggestion.
 *
 * This is the one number behind how often a request goes out while typing, so it
 * is the user's to set: a large value asks rarely and reads as a slow
 * suggestion, a small one asks on almost every keystroke. The input stays
 * uncontrolled so typing is never interrupted by the echo, and only a value the
 * timer can take is written back — a half-typed one is left where it is, and the
 * field settles on what was stored when it loses focus.
 */
const AiDelayField = () => {
  const intl = useIntl()
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(setConfigAtom)
  const inputRef = useRef()
  const label = intl.formatMessage({id: 'preference.ai_delay'})

  const handleChange = event => {
    const delay = Number(event.target.value)

    if (event.target.value === '' || !Number.isFinite(delay)) {
      return
    }

    setConfig({ai_delay: Math.min(MAX, Math.max(MIN, Math.round(delay)))})
  }

  return (
    <div className='setting'>
      <div>
        <div className='setting__label'>{label}</div>
        <div className='setting__desc'>
          {intl.formatMessage({id: 'preference.ai_delay_description'}, {min: MIN, max: MAX})}
        </div>
      </div>

      <div className='setting__control'>
        <input
          ref={inputRef}
          className='input'
          type='number'
          min={MIN}
          max={MAX}
          step={50}
          defaultValue={config.ai_delay}
          aria-label={label}
          spellCheck={false}
          autoComplete='off'
          onChange={handleChange}
          onBlur={() => {
            if (inputRef.current) {
              inputRef.current.value = config.ai_delay
            }
          }}
        />
      </div>
    </div>
  )
}

export default AiDelayField
