import PropTypes from 'prop-types'
import {useAtomValue, useSetAtom} from 'jotai'
import {useIntl} from 'react-intl'

import {configAtom, setConfigAtom} from '../../stores/config'

/**
 * One on/off preference, as a `.setting` row: label and description on the left,
 * the switch on the right, and the label read from the messages like any other.
 */
const SwitchField = ({labelId, descriptionId, configKey}) => {
  const intl = useIntl()
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(setConfigAtom)
  const label = intl.formatMessage({id: labelId})

  return (
    <div className='setting'>
      <div>
        <div className='setting__label'>{label}</div>
        <div className='setting__desc'>
          {intl.formatMessage({id: descriptionId})}
        </div>
      </div>

      <div className='setting__control'>
        <label className='switch'>
          <input
            type='checkbox'
            checked={config[configKey]}
            aria-label={label}
            onChange={event => setConfig({[configKey]: event.target.checked})}
          />
          <span className='switch__track'/>
        </label>
      </div>
    </div>
  )
}

SwitchField.propTypes = {
  labelId: PropTypes.string.isRequired,
  descriptionId: PropTypes.string.isRequired,
  configKey: PropTypes.string.isRequired,
}

export default SwitchField
