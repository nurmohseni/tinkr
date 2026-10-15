import {FormattedMessage} from 'react-intl'

/**
 * The hint beside the key picker, as the design system's CSS-only tooltip: the
 * bubble is revealed on hover or focus.
 */
const SSHKeyTooltip = () => (
  <span className='tooltip'>
    <svg
      width='12'
      height='12'
      viewBox='0 0 16 16'
      aria-hidden='true'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.2'
      className='faint'
    >
      <circle cx='8' cy='8' r='6.2'/>
      <path d='M8 7.4v3.6' strokeLinecap='round'/>
      <circle cx='8' cy='5.3' r='0.9' fill='currentColor' stroke='none'/>
    </svg>

    <span className='tooltip__bubble tooltip__bubble--wrap'>
      <FormattedMessage id='connections.ssh_key_tooltip'/>
    </span>
  </span>
)

export default SSHKeyTooltip
