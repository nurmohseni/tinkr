import {useSetAtom} from 'jotai'
import {useIntl} from 'react-intl'

import {reconnectAtom} from '../../stores/editor'

/**
 * The output panel's reconnect action, as the design's ghost icon button.
 */
const ReconnectButton = () => {
  const intl = useIntl()
  const reconnect = useSetAtom(reconnectAtom)
  const label = intl.formatMessage({id: 'editor.reconnect'})

  return (
    <button
      className='btn btn--ghost btn--icon'
      type='button'
      title={label}
      aria-label={label}
      onClick={() => reconnect()}
    >
      <svg width='14' height='14' viewBox='0 0 16 16' aria-hidden='true' fill='none' stroke='currentColor' strokeWidth='1.2'>
        <path d='M13.2 5.9A5.6 5.6 0 103.9 12.2' strokeLinecap='round'/>
        <path d='M13.4 2.4v3.5H9.9' strokeLinecap='round' strokeLinejoin='round'/>
      </svg>
    </button>
  )
}

export default ReconnectButton
