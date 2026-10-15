import {useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import {configAtom, setConfigAtom} from '../../stores/config'

/**
 * The interface theme. `default` and `classic` both land on the light palette —
 * the app has no third look — so the pair reads as Default/Dark, and a saved
 * `classic` shows as Default.
 */
const ThemeField = () => {
  const intl = useIntl()
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(setConfigAtom)

  const isDark = config.theme === 'dark'
  const label = intl.formatMessage({id: 'preference.theme'})

  return (
    <div className='setting'>
      <div>
        <div className='setting__label'>{label}</div>
      </div>

      <div className='setting__control'>
        <div
          className='segmented'
          role='radiogroup'
          aria-label={label}
        >
          <label className='segmented__item'>
            <input
              type='radio'
              name='theme'
              checked={!isDark}
              onChange={() => setConfig({theme: 'default'})}
            />
            {intl.formatMessage({id: 'preference.theme_default'})}
          </label>

          <label className='segmented__item'>
            <input
              type='radio'
              name='theme'
              checked={isDark}
              onChange={() => setConfig({theme: 'dark'})}
            />
            {intl.formatMessage({id: 'preference.theme_dark'})}
          </label>
        </div>
      </div>
    </div>
  )
}

export default ThemeField
