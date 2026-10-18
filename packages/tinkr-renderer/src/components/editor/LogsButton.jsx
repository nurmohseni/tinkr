import {useIntl} from 'react-intl'

import {openLogs} from '../../utils/api'

/**
 * The log viewer, as an affordance in the title bar beside settings.
 *
 * A log is read against the code rather than in it, so it is its own window
 * rather than a tab of the editor, and this is what opens it. The window belongs
 * to the main process, which raises the one already open rather than making a
 * second, so pressing this twice cannot leave two of them.
 *
 * The mark is three bars of the app's own geometry, shortening as they go: the
 * same family as the tree's lines and the brand, and not a page with ruled lines.
 */
const LogsButton = () => {
  const intl = useIntl()
  const label = intl.formatMessage({id: 'editor.logs_title'})

  return (
    <button
      className='btn btn--ghost btn--icon'
      type='button'
      title={label}
      aria-label={label}
      onClick={() => openLogs()}
    >
      <svg width='14' height='14' viewBox='0 0 14 14' aria-hidden='true' fill='currentColor'>
        <path d='M2.5 3H11.5L10.6 4.7H1.6Z'/>
        <path d='M2.5 5.9H10.6L9.7 7.6H1.6Z'/>
        <path d='M2.5 8.8H9.7L8.8 10.5H1.6Z'/>
      </svg>
    </button>
  )
}

export default LogsButton
