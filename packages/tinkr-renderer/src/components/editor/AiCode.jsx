import {Fragment, useMemo} from 'react'
import PropTypes from 'prop-types'

import {highlightCode} from '../../utils/aiCodeHighlight'

/**
 * The code an answer proposes, as code: one well, in the editor's own colours,
 * keeping the lines the way they were written.
 *
 * A long line scrolls sideways rather than wrapping — a wrapped call reads as
 * two — and a long snippet keeps a height of its own so the thread can still be
 * read past it. Copying the snippet out of the panel gives back the lines it was
 * written with, because the breaks are the text's own.
 */
const AiCode = ({code}) => {
  const rows = useMemo(() => highlightCode(code), [code])

  return (
    <div className='ai__code'>
      <pre className='printed ai__code-pre'>
        {rows.map((spans, line) => (
          <Fragment key={line}>
            {spans.map((span, at) => (span.className === ''
              ? span.text
              : <span className={span.className} key={at}>{span.text}</span>))}
            {line < rows.length - 1 ? '\n' : null}
          </Fragment>
        ))}
      </pre>
    </div>
  )
}

AiCode.propTypes = {
  code: PropTypes.string.isRequired,
}

export default AiCode
