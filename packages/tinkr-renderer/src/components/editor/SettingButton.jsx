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
      {/* a cog, not a sun: eight trapezoid teeth around a hole, which is what
          tells the two apart at fourteen pixels — the rayed ring this used to
          be read as a brightness toggle */}
      <svg
        width='14'
        height='14'
        viewBox='0 0 16 16'
        aria-hidden='true'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.1'
        strokeLinejoin='round'
      >
        <path d='M6.0 3.3 6.3 1.2 9.7 1.2 10.0 3.3 10.0 3.3 11.6 2.0 14.0 4.4 12.7 6.0 12.7 6.0 14.8 6.3 14.8 9.7 12.7 10.0 12.7 10.0 14.0 11.6 11.6 14.0 10.0 12.7 10.0 12.7 9.7 14.8 6.3 14.8 6.0 12.7 6.0 12.7 4.4 14.0 2.0 11.6 3.3 10.0 3.3 10.0 1.2 9.7 1.2 6.3 3.3 6.0 3.3 6.0 2.0 4.4 4.4 2.0 6.0 3.3ZM8.0 5.8a2.1 2.1 0 1 0 0 4.30a2.1 2.1 0 1 0 0 -4.30Z'/>
      </svg>
    </button>
  )
}

export default SettingButton
