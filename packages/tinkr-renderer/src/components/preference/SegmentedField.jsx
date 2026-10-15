import PropTypes from 'prop-types'
import {useAtomValue, useSetAtom} from 'jotai'
import {useIntl} from 'react-intl'

import {configAtom, setConfigAtom} from '../../stores/config'

/**
 * One preference that is a choice between a few named values, as a `.setting`
 * row with the app's segmented control on the right.
 *
 * The value it writes is the option's `value`, and the label is a message, so a
 * row is its ids and its options and nothing else.
 */
const SegmentedField = ({labelId, descriptionId, configKey, options}) => {
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
        <div className='segmented' role='radiogroup' aria-label={label}>
          {options.map(option => (
            <label key={option.value} className='segmented__item'>
              <input
                type='radio'
                name={configKey}
                checked={config[configKey] === option.value}
                onChange={() => setConfig({[configKey]: option.value})}
              />
              {intl.formatMessage({id: option.labelId})}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

SegmentedField.propTypes = {
  labelId: PropTypes.string.isRequired,
  descriptionId: PropTypes.string.isRequired,
  configKey: PropTypes.string.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.string.isRequired,
    labelId: PropTypes.string.isRequired,
  })).isRequired,
}

export default SegmentedField
