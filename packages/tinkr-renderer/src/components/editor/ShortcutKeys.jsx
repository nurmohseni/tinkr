import PropTypes from 'prop-types'

// the accelerators the app stores, as isMatchShortcut reads them
const labels = {
  Control: 'Ctrl',
  Meta: '⌘',
  Shift: '⇧',
  Alt: 'Alt',
}

/**
 * The keycaps of an accelerator the app holds, for the primary control they
 * trigger.
 */
const ShortcutKeys = ({keys}) => (
  <span className='row' style={{gap: 'var(--s1)'}}>
    {keys.map((key, index) => (
      <kbd
        key={`${key}_${index}`}
        className='keycap keycap--on-primary'
      >
        {labels[key] || key.toUpperCase()}
      </kbd>
    ))}
  </span>
)

ShortcutKeys.propTypes = {
  keys: PropTypes.arrayOf(PropTypes.string).isRequired,
}

export default ShortcutKeys
