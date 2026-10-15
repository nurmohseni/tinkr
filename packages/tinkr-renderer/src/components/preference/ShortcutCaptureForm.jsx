import {useState} from 'react'
import PropTypes from 'prop-types'
import {FormattedMessage, useIntl} from 'react-intl'

import KeyCode from './KeyCode'

/**
 * The recorder's body: the keys pressed so far as keycaps, over a field that
 * swallows the keystrokes. Enter keeps the combination, Esc drops it.
 */
const ShortcutCaptureForm = ({defaultValue, close, onEnter}) => {
  const intl = useIntl()
  const [keys, setKeys] = useState(defaultValue)
  const [isRecording, setIsRecording] = useState(false)

  const pushKey = key => {
    setKeys(prevKeys => {
      if (prevKeys.indexOf(key) === -1) {
        return [
          ...prevKeys,
          key,
        ]
      }

      return prevKeys
    })
  }

  const handleChange = e => {
    e.preventDefault()
  }

  const handleKeyDown = e => {
    e.preventDefault()

    if (e.key === 'Enter') {
      // 关闭并且保存
      onEnter(keys)
      close()
      return
    }

    if (e.key === 'Escape') {
      close()
      return
    }

    if (!isRecording) {
      setKeys([])
      setIsRecording(true)
    }

    pushKey(e.key)
  }

  const handleKeyUp = e => {
    e.preventDefault()
    setIsRecording(false)
  }

  const label = intl.formatMessage({id: 'preference.shortcut_capture_label'})

  return (
    <>
      <div className='modal__header'>
        <FormattedMessage id='preference.shortcut_capture_label'/>
      </div>

      <div className='modal__body'>
        <input
          className='input'
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          onBlur={close}
          onKeyUp={handleKeyUp}
          value={keys.join('+')}
          aria-label={label}
          spellCheck={false}
          autoComplete='off'
          autoFocus
          style={{textAlign: 'center'}}
        />

        <div
          className='row'
          style={{marginTop: 'var(--s2)', justifyContent: 'center'}}
        >
          {keys.map(key => (
            <KeyCode
              key={`keys_${key}`}
              value={key}
            />
          ))}
        </div>
      </div>
    </>
  )
}

ShortcutCaptureForm.propTypes = {
  defaultValue: PropTypes.array,
  close: PropTypes.func,
  onEnter: PropTypes.func.isRequired,
}

ShortcutCaptureForm.defaultProps = {
  defaultValue: [],
  close: () => false,
}

export default ShortcutCaptureForm
