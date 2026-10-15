import {useIntl} from 'react-intl'

import {openPreference} from '../../utils/api'

/**
 * Settings, as an affordance in the title bar: an icon action on the raised
 * panel, the same as the design's `.btn.btn--ghost.btn--icon`.
 *
 * The preference window belongs to the main process, so the click asks for it
 * over the `openPreference` channel rather than opening it here.
 */
const SettingButton = () => {
  const intl = useIntl()
  const label = intl.formatMessage({id: 'menu.settings'})

  return (
    <button
      className='btn btn--ghost btn--icon'
      type='button'
      title={label}
      aria-label={label}
      onClick={() => openPreference()}
    >
      <svg
        width='14'
        height='14'
        viewBox='0 0 16 16'
        aria-hidden='true'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.2'
      >
        <circle cx='8' cy='8' r='2.4'/>
        <path
          d='M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3'
          strokeLinecap='round'
        />
      </svg>
    </button>
  )
}

export default SettingButton
