import {FormattedMessage, useIntl} from 'react-intl'
import PropTypes from 'prop-types'

import AiCode from './AiCode'
import AiProse from './AiProse'

/**
 * One exchange: what was asked, what came back, and — when the answer carries
 * code — the snippet it proposes to put in the editor, which is the user's to
 * take or to put aside.
 *
 * The ask is drawn from the moment it is made, so the thread reads as what was
 * said rather than as what has been answered: the answer takes its place under
 * it when it comes. The ask is set as a quotation and the answer as the page, so
 * the two are read in the order they happened rather than as two paragraphs of
 * equal weight.
 */
const AiTurn = ({turn, onApply, onDiscard}) => {
  const intl = useIntl()

  return (
    <article className='ai__turn'>
      <div className='ai__ask-row'>
        <span className='ai__who'><FormattedMessage id='editor.ai_you'/></span>
        <p className='ai__question'>{turn.prompt}</p>
      </div>

      <div className='ai__answer'>
        <span className='ai__who'><FormattedMessage id='editor.ai'/></span>

        {turn.asking && (
          <p className='ai__asking'><FormattedMessage id='editor.ai_asking'/></p>
        )}

        {turn.text !== '' && turn.failed && (
          // an answer that never came is the only thing in the panel announced
          // without being looked at
          <div role='alert'>
            <AiProse text={turn.text} className='ai__text error'/>
          </div>
        )}

        {turn.text !== '' && !turn.failed && (
          <AiProse text={turn.text} className='ai__text'/>
        )}

        {turn.code !== null && (
          <>
            <AiCode code={turn.code}/>

            <div className='ai__actions'>
              {turn.resolution === null ? (
                <>
                  <button
                    className='btn btn--primary btn--sm'
                    type='button'
                    onClick={() => onApply(turn)}
                  >
                    {intl.formatMessage({id: 'editor.ai_apply'})}
                  </button>
                  <button
                    className='btn btn--ghost btn--sm'
                    type='button'
                    onClick={() => onDiscard(turn)}
                  >
                    {intl.formatMessage({id: 'editor.ai_discard'})}
                  </button>
                </>
              ) : (
                <span className='muted'>
                  <FormattedMessage id={turn.resolution === 'applied' ? 'editor.ai_applied' : 'editor.ai_discarded'}/>
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  )
}

AiTurn.propTypes = {
  turn: PropTypes.object.isRequired,
  onApply: PropTypes.func.isRequired,
  onDiscard: PropTypes.func.isRequired,
}

export default AiTurn
