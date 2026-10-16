import {useAtom} from 'jotai'
import {useIntl} from 'react-intl'

import {dryRunAtom} from '../../stores/editor'

/**
 * The switch next to Run: whether a run is sent inside a transaction that is
 * taken back when the run is done, instead of whatever the run does being kept.
 *
 * It is an icon, and which icon is the state: a box the run sits inside where
 * the run is guarded, the same box struck through where it is not — with the
 * sentence either way in the tooltip, since a button's width is not the place
 * for it.
 *
 * What it switches is read when a run is sent and not stored with it, so setting
 * it decides the run after it, and the run that is already in the pane keeps what
 * it was sent with. It guards the default connection of the session the run is
 * booted in, which is what a run over ssh is guarded on the far side of as well.
 */
const DryRunButton = () => {
  const intl = useIntl()
  const [dryRun, setDryRun] = useAtom(dryRunAtom)

  // the tooltip is the one place the click is spelled out, so it says what the
  // click does: the icon already tells which state the switch is in
  const label = intl.formatMessage({id: dryRun ? 'editor.dry_run_off' : 'editor.dry_run'})

  return (
    <button
      className='btn btn--secondary btn--icon'
      type='button'
      title={label}
      aria-label={label}
      aria-pressed={dryRun}
      onClick={() => setDryRun(value => !value)}
    >
      <svg
        width='14'
        height='14'
        viewBox='0 0 16 16'
        aria-hidden='true'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
      >
        {/* the transaction, either way: a run with a transaction around it is a
            run whose statements are all kept or all taken back */}
        <rect x='2.6' y='3.2' width='10.8' height='9.6' rx='1.8'/>
        {dryRun ? (
          // the run is in it: the statement the transaction is holding
          <circle cx='8' cy='8' r='1.15' fill='currentColor' stroke='none'/>
        ) : (
          // nothing is holding it: the transaction is not there
          <path d='M3.4 12.6L12.6 3.4'/>
        )}
      </svg>
    </button>
  )
}

export default DryRunButton
