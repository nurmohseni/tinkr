import {useIntl} from 'react-intl'

import useNewSession from '../../hooks/useNewSession'

/**
 * The + in the snippets section title: a ghost icon action on the row's
 * baseline, as in the design — and the way to a session that has no snippet
 * yet, since nothing but Save creates one.
 *
 * It starts a session rather than replacing the one the window is on: a
 * connection can hold any number of them at once, each its own tab, so a + has
 * nothing to ask first.
 */
const NewSessionButton = () => {
  const intl = useIntl()
  const startSession = useNewSession()
  const label = intl.formatMessage({id: 'editor.new_session'})

  return (
    <button
      className='btn btn--ghost btn--icon btn--sm'
      type='button'
      title={label}
      aria-label={label}
      onClick={() => startSession()}
    >
      <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'>
        <path d='M5 1v8M1 5h8' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round'/>
      </svg>
    </button>
  )
}

export default NewSessionButton
