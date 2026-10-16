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
        {/* the mark is the signature itself: two bare bars, ink over verdigris,
            the lower one where the value lands — no tile behind them */}
        <svg width='16' height='16' viewBox='0 0 16 16' aria-hidden='true'>
          <path d='M4.6 4.5H14L12.6 7H3.2Z' fill='var(--text)'/>
          <path d='M3.4 9H12.8L11.4 11.5H2Z' fill='var(--accent)'/>
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
