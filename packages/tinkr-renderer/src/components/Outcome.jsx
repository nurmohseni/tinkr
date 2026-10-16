import PropTypes from 'prop-types'
import {useIntl} from 'react-intl'

/**
 * The app's outcome: the return bars, in the three things a run can honestly
 * say.
 *
 * Two bars is the `=` a session prints before a value it returned, one bar is
 * what a run only printed, and the bars struck through are a throw. It is the
 * one place the signature is drawn, so wherever a run's outcome is said — the
 * result summary, the History ledger, the Output tab, a client that is
 * configured — it is the same shape, the same colour and the same word.
 *
 * The word is the outcome's own message unless a caller names one, and it is
 * drawn only when the caller asks for the label: where the glyph is read at a
 * glance the word stays for readers that cannot see it.
 */
/* The three marks, built where they are drawn: an element made at import time
   would be built before the module graph is up, which is what the test harness
   renders these files under. */
const mark = kind => {
  if (kind === 'printed') {
    return <path d='M2.8 5.1H10.2L9.2 6.9H1.8Z'/>
  }

  const bars = (
    <>
      <path d='M3.2 3.5H10.6L9.6 5.3H2.2Z'/>
      <path className='outcome__bar--last' d='M2.4 6.7H9.8L8.8 8.5H1.4Z'/>
    </>
  )

  if (kind !== 'threw') {
    return bars
  }

  return (
    <>
      {bars}
      {/* the slash is drawn last so the landing can strike the bars through */}
      <path
        className='outcome__slash'
        d='M8.6 1.4L3.4 10.6'
        strokeWidth='1.3'
        strokeLinecap='round'
      />
    </>
  )
}

const Outcome = ({kind, label = false, animate = false, text = null}) => {
  const intl = useIntl()
  const word = text || intl.formatMessage({id: `editor.history_${kind}`})

  return (
    <span
      className={`outcome outcome--${kind}`}
      data-animate={animate || undefined}
    >
      <svg
        className='outcome__mark'
        width='12'
        height='12'
        viewBox='0 0 12 12'
        fill='currentColor'
        stroke='currentColor'
        aria-hidden='true'
      >
        {mark(kind)}
      </svg>

      <span className={label ? 'outcome__word' : 'sr-only'}>{word}</span>
    </span>
  )
}

Outcome.propTypes = {
  kind: PropTypes.oneOf(['returned', 'printed', 'threw']).isRequired,
  // whether the word is drawn beside the glyph or kept for screen readers
  label: PropTypes.bool,
  // whether this glyph is the one landing: the lower bar draws, and a throw
  // strikes through it a beat later
  animate: PropTypes.bool,
  // the word to say, where the outcome's own message is not what this place
  // calls it
  text: PropTypes.string,
}

export default Outcome
