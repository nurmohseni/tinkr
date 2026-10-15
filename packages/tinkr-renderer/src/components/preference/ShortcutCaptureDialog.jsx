import PropTypes from 'prop-types'
import {createPortal} from 'react-dom'

import ShortcutCaptureForm from './ShortcutCaptureForm'

/**
 * The recorder, over the window. It is portalled to the body, like the dialog
 * it replaces: the settings column scrolls, and a modal belongs over the whole
 * window. Clicking outside or blurring the field closes it.
 */
const ShortcutCaptureDialog = ({defaultValue, onEnter, onCloseComplete}) => createPortal(
  <div
    className='modal-overlay'
    onClick={onCloseComplete}
  >
    <div
      className='modal modal--narrow'
      role='dialog'
      aria-modal='true'
      onClick={event => event.stopPropagation()}
    >
      <ShortcutCaptureForm
        defaultValue={defaultValue}
        onEnter={onEnter}
        close={onCloseComplete}
      />
    </div>
  </div>,
  document.body,
)

ShortcutCaptureDialog.propTypes = {
  defaultValue: PropTypes.array.isRequired,
  onEnter: PropTypes.func.isRequired,
  onCloseComplete: PropTypes.func.isRequired,
}

export default ShortcutCaptureDialog
