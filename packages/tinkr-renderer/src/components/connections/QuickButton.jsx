import {useIntl} from 'react-intl'

import {quickConnect} from '../../utils/api'

/**
 * Quick connect: picks a directory and opens it as a new connection, so it sits
 * next to New on the connections title row.
 */
const QuickButton = () => {
  const intl = useIntl()

  const label = intl.formatMessage({id: 'connections.quick_connect'})

  const handleClick = () => {
    quickConnect()
  }

  return (
    <button
      className='btn btn--ghost btn--icon btn--sm'
      type='button'
      title={label}
      aria-label={label}
      onClick={handleClick}
    >
      <svg
        width='12'
        height='12'
        viewBox='0 0 16 16'
        aria-hidden='true'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.2'
      >
        <path d='M1.5 4.2A1.2 1.2 0 012.7 3h2.9l1.4 1.6h6.3A1.2 1.2 0 0114.5 5.8v6A1.2 1.2 0 0113.3 13H2.7a1.2 1.2 0 01-1.2-1.2z'/>
      </svg>
    </button>
  )
}

export default QuickButton
