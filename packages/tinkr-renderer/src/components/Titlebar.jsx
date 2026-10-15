import PropTypes from 'prop-types'

import SettingButton from './editor/SettingButton'
import appVersion from '../utils/appVersion'

/**
 * The app's own top strip.
 *
 * The window is framed by the platform, so the design's `.titlebar__controls`
 * slot is not drawn: the brand takes the leading slot instead, the connection
 * string sits centred, and the settings affordance closes the row.
 */
const Titlebar = ({children}) => (
  <header className='titlebar'>
    <div className='titlebar__side'>
      <span className='brand' title={`Tinkr ${appVersion}`}>
        <svg width='18' height='18' viewBox='0 0 18 18' aria-hidden='true'>
          <defs>
            <linearGradient id='brandGrad' x1='0' y1='0' x2='1' y2='1'>
              <stop offset='0' stopColor='#4F46E5'/>
              <stop offset='1' stopColor='#7C3AED'/>
            </linearGradient>
          </defs>
          <rect x='0.5' y='0.5' width='17' height='17' rx='5' fill='url(#brandGrad)'/>
          <path
            d='M6 4.6L11 9l-5 4.4'
            fill='none'
            stroke='#fff'
            strokeWidth='1.8'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path d='M14.2 3.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' fill='#22D3EE'/>
        </svg>
        <span className='brand__word'>Tinkr</span>
      </span>
    </div>

    <div className='titlebar__center'>{children}</div>

    <div className='titlebar__side titlebar__side--end'>
      <SettingButton/>
    </div>
  </header>
)

Titlebar.propTypes = {
  children: PropTypes.node,
}

export default Titlebar
