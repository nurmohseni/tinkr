import {useEffect} from 'react'
import {useIntl} from 'react-intl'
import {useLocation} from 'wouter'
import {useAtomValue} from 'jotai'

import {configAtom} from '../../stores/config'
import {isMatchShortcut} from '../../utils/isMatchShortcut'
import {newConnectionId} from '../../utils/newConnection'

/**
 * New connection: the + on the connections title row, as the design draws its
 * new-snippet affordance. It opens the dialog on a connection that is not
 * stored yet: the draft belongs to the dialog, and nothing of it is written
 * unless the user confirms it, so a cancelled dialog leaves no connection
 * behind. The shortcut is the same as clicking the +.
 */
const CreateButton = () => {
  const [, setLocation] = useLocation()
  const config = useAtomValue(configAtom)
  const intl = useIntl()

  const label = intl.formatMessage({id: 'connections.create'})

  useEffect(() => {
    const listener = e => {
      const tagName = e.target.tagName
      const isInputField = tagName.isContentEditable ||
        tagName === 'INPUT' ||
        tagName === 'SELECT' ||
        tagName === 'TEXTAREA'

      if (
        !isInputField &&
        isMatchShortcut(e, config.shortcut_new_connection)
      ) {
        handleClick()
        return false
      }

      return true
    }
    document.addEventListener('keydown', listener, false)

    return () => {
      document.removeEventListener('keydown', listener, false)
    }
  }, [config.shortcut_new_connection])

  const handleClick = () => {
    setLocation(`/connections/${newConnectionId}`)
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
        width='10'
        height='10'
        viewBox='0 0 10 10'
        aria-hidden='true'
      >
        <path d='M5 1v8M1 5h8' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round'/>
      </svg>
    </button>
  )
}

export default CreateButton
