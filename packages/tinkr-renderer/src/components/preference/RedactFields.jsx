import {useCallback} from 'react'
import {useIntl} from 'react-intl'
import debounce from 'lodash/debounce'
import {useAtomValue, useSetAtom} from 'jotai'

import {configAtom, setConfigAtom} from '../../stores/config'

/**
 * The fields a run's values are hidden by, one per line.
 *
 * The list is written back after a pause, so a half-typed pattern is never what
 * hides a run, and an input that keeps its own text is never rewritten under
 * the caret. A comma is a separator too: the description says so, and a list
 * pasted from anywhere is read the way it reads.
 */
const RedactFields = () => {
  const intl = useIntl()
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(setConfigAtom)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const write = useCallback(debounce(fields => {
    setConfig({redact_fields: fields})
  }, 200), [])

  const handleChange = event => {
    write(event.target.value
      .split(/[\n,]/)
      .map(field => field.trim())
      .filter(Boolean))
  }

  const label = intl.formatMessage({id: 'preference.redact_fields'})

  return (
    <div className='setting'>
      <div>
        <div className='setting__label'>{label}</div>
        <div className='setting__desc'>{intl.formatMessage({id: 'preference.redact_fields_description'})}</div>
      </div>

      <div className='setting__control'>
        <textarea
          className='textarea mono'
          rows={4}
          defaultValue={(config.redact_fields || []).join('\n')}
          aria-label={label}
          spellCheck={false}
          autoComplete='off'
          onChange={handleChange}
        />
      </div>
    </div>
  )
}

export default RedactFields
