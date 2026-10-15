import {useIntl} from 'react-intl'
import {useAtomValue} from 'jotai'

import {allLocales, setLocale} from '../../utils/api'
import {configAtom} from '../../stores/config'

/**
 * The language the app's own copy is shown in.
 *
 * It is a row in the general settings. Switching it asks the main process for
 * the locale rather than writing the config here, because a new locale is a new
 * set of messages as well as a new value, and the main process is what holds
 * them and hands them to every window.
 */
const LocaleSelectField = () => {
  const intl = useIntl()
  const config = useAtomValue(configAtom)

  const label = intl.formatMessage({id: 'preference.locale'})

  const handleChange = e => {
    setLocale(e.target.value)
  }

  return (
    <div className='setting'>
      <div>
        <div className='setting__label'>{label}</div>
      </div>

      <div className='setting__control'>
        <select
          className='select'
          value={config.locale}
          aria-label={label}
          onChange={handleChange}
        >
          {allLocales().map(locale => (
            <option
              key={`locales_${locale}`}
              value={locale}
            >
              {intl.formatMessage({id: locale})}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export default LocaleSelectField
