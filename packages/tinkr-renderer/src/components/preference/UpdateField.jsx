import {useState} from 'react'
import {useIntl} from 'react-intl'

import {checkForUpdates} from '../../utils/api'
import appVersion from '../../utils/appVersion'

/**
 * The one row that asks the releases on demand, for whoever would rather not
 * wait for the check the app makes as it opens.
 *
 * The answer is the description: the version this build is, whether that is the
 * newest one, a version that is out, or why the question could not be put to the
 * releases at all. Saying so matters, because a build that was not installed
 * from a release can never replace itself, and a button that quietly did nothing
 * would read as broken. Nothing here downloads or installs: when something is
 * out, the app's own prompt offers it.
 */
const UpdateField = () => {
  const intl = useIntl()
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')

  const handleCheck = async () => {
    setChecking(true)
    setMessage('')

    try {
      const {status, latest, message: failure} = await checkForUpdates()

      setMessage(intl.formatMessage(
        {id: `preference.updates_${status}`},
        {version: appVersion, latest, message: failure},
      ))
    } catch (e) {
      setMessage(intl.formatMessage(
        {id: 'preference.updates_failed'},
        {message: e.message},
      ))
    }

    setChecking(false)
  }

  return (
    <div className='setting'>
      <div>
        <div className='setting__label'>
          {intl.formatMessage({id: 'preference.updates'})}
        </div>
        <div className='setting__desc'>
          {message === ''
            ? intl.formatMessage({id: 'preference.updates_description'})
            : message}
        </div>
      </div>

      <div className='setting__control'>
        <button
          className='btn btn--secondary'
          type='button'
          disabled={checking}
          aria-busy={checking}
          onClick={handleCheck}
        >
          {intl.formatMessage({
            id: checking ? 'preference.updates_checking' : 'preference.updates_check',
          })}
        </button>
      </div>
    </div>
  )
}

export default UpdateField
