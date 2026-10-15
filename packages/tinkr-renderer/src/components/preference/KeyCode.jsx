import PropTypes from 'prop-types'

// the accelerators the app stores, as isMatchShortcut reads them
const labels = {
  Meta: '⌘',
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: '⇧',
  Escape: 'Esc',
  Tab: 'Tab',
  Enter: '↵',
  Backspace: '⌫',
  Delete: '⌦',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'Space',
}

/**
 * One key of an accelerator, as a keycap. The modifiers are named by their
 * symbol; anything else is shown as typed.
 */
const KeyCode = ({value}) => (
  <kbd className='keycap'>{labels[value] || (value.length === 1 ? value.toUpperCase() : value)}</kbd>
)

KeyCode.propTypes = {
  value: PropTypes.string.isRequired,
}

export default KeyCode
