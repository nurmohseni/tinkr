import {useState} from 'react'
import PropTypes from 'prop-types'
import {useAtomValue, useSetAtom} from 'jotai'

import KeyCode from './KeyCode'
import ShortcutCaptureDialog from './ShortcutCaptureDialog'
import {configAtom, setConfigAtom} from '../../stores/config'

/**
 * One binding, as a settings row: its keycaps on the right open the recorder.
 * The design keeps the caps in a fixed column so the rows line up.
 */
const ShortcutField = ({label, description, configKey}) => {
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(setConfigAtom)

  const [isShown, setIsShown] = useState(false)

  const handleEnter = (keys) => {
    setConfig({
      [configKey]: keys,
    })
  }

  return (
    <div className='setting'>
      <div>
        <div className='setting__label'>{label}</div>
        <div className='setting__desc'>{description}</div>
      </div>

      <div className='setting__control keycap-row'>
        <button
          className='btn btn--ghost'
          type='button'
          title={label}
          onClick={() => setIsShown(true)}
        >
          <span className='keycap-row__keys'>
            {config[configKey].map(key => (
              <KeyCode
                key={`${configKey}_keys_${key}`}
                value={key}
              />
            ))}
          </span>
        </button>
      </div>

      {isShown && (
        <ShortcutCaptureDialog
          defaultValue={config[configKey]}
          onEnter={handleEnter}
          onCloseComplete={() => setIsShown(false)}
        />
      )}
    </div>
  )
}

ShortcutField.propTypes = {
  label: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  configKey: PropTypes.string.isRequired,
}

export default ShortcutField
