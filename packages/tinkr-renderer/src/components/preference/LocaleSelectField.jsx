import {useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import {allLocales} from '../../utils/api'
import {configAtom, setConfigAtom} from '../../stores/config'

/**
 * The locale the app's own copy is shown in. Nothing mounts this row: the
 * locale is switched by the window's intl provider, and no section lists it, so
 * it is kept only as the setting's control for whoever surfaces it.
 */
const LocaleSelectField = () => {
  const intl = useIntl()
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(setConfigAtom)

  const label = intl.formatMessage({id: 'preference.locale'})

  const handleChange = e => {
    setConfig({
      locale: e.target.value,
    })
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
