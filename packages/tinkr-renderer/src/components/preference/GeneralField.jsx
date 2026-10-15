import {useCallback} from 'react'
import PropTypes from 'prop-types'
import debounce from 'lodash/debounce'
import {useAtomValue, useSetAtom} from 'jotai'

import {configAtom, setConfigAtom} from '../../stores/config'

/**
 * One string preference, as a `.setting` row: label and description on the
 * left, the input on the right. The value is written back after a pause, and
 * the input stays uncontrolled so typing is never interrupted by the echo.
 */
const GeneralField = ({label, description, configKey, type, placeholder}) => {
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(setConfigAtom)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setConfigBounced = useCallback(debounce(value => {
    setConfig({
      [configKey]: value,
    })
  }, 200), [])

  const handleChange = e => {
    setConfigBounced(e.target.value)
  }

  return (
    <div className='setting'>
      <div>
        <div className='setting__label'>{label}</div>
        <div className='setting__desc'>{description}</div>
      </div>

      <div className='setting__control'>
        <input
          className='input'
          type={type}
          defaultValue={config[configKey]}
          placeholder={placeholder}
          aria-label={label}
          spellCheck={false}
          autoComplete='off'
          onChange={handleChange}
        />
      </div>
    </div>
  )
}

GeneralField.propTypes = {
  label: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  configKey: PropTypes.string.isRequired,
  type: PropTypes.string,
  placeholder: PropTypes.string,
}

GeneralField.defaultProps = {
  type: 'text',
  placeholder: undefined,
}

export default GeneralField
