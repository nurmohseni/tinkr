import {createPortal} from 'react-dom'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import {
  confirmMutationsAtom,
  connectionAtom,
  dismissMutationsAtom,
  mutationGateAtom,
} from '../../stores/editor'

/**
 * What a run that writes to a production connection asks before it is sent.
 *
 * Nothing the app sends can be brought back once it has run on that connection,
 * so a run that writes is held rather than sent, and this is where it is held.
 * The question carries what the pre-flight scan found — the line and the call —
 * because that is the one part of the run a reader can weigh before it happens;
 * the code itself is on the screen behind the box, so the list stays the calls.
 *
 * Both answers are on the box, and both end the question: cancelling drops the
 * run, which is the answer that leaves everything as it was, and the run that is
 * allowed through is the run that was held, with the guard it already had. The
 * run decides whether the question is asked at all — a run that only reads, a
 * run the guard takes back, and a connection tagged anything but production ask
 * nothing: see the store's runAtom.
 */
const MutationConfirm = () => {
  const intl = useIntl()
  const held = useAtomValue(mutationGateAtom)
  const connection = useAtomValue(connectionAtom) || {}
  const confirm = useSetAtom(confirmMutationsAtom)
  const dismiss = useSetAtom(dismissMutationsAtom)

  if (!held) {
    return null
  }

  return createPortal(
    <div className='modal-overlay'>
      <div
        className='modal modal--narrow'
        role='dialog'
        aria-modal='true'
        aria-labelledby='mutation-title'
      >
        <header
          className='modal__header'
          id='mutation-title'
        >
          {intl.formatMessage({id: 'mutation.title'})}
        </header>

        <div className='modal__body'>
          <FormattedMessage
            id='mutation.content'
            values={{connection: connection.name}}
          />

          {held.writes.map(one => (
            <div key={`${one.line}:${one.call}`}>
              <strong>{one.call}</strong>

              <span>{` ${intl.formatMessage({id: 'mutation.line'})} ${one.line}`}</span>
            </div>
          ))}
        </div>

        <footer className='modal__footer'>
          <button
            className='btn btn--ghost'
            type='button'
            onClick={dismiss}
          >
            {intl.formatMessage({id: 'cancel'})}
          </button>

          <button
            className='btn btn--primary'
            type='button'
            onClick={confirm}
          >
            {intl.formatMessage({id: 'mutation.run'})}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export default MutationConfirm
