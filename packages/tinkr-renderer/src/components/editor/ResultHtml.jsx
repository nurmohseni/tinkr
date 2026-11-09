import PropTypes from 'prop-types'
import {useIntl} from 'react-intl'

import {htmlDocument, htmlOf} from '../../utils/resultReading'

/**
 * The html reading of a value: a string that is markup, drawn as a document is
 * drawn, which is how a dumped view or a mailable is read.
 *
 * A value the run rendered is read from what the envelope kept of it — a view's
 * markup, a mailable's, an `Htmlable` component's — and a string the run
 * returned is read as the markup it looks like. Both are the same frame.
 *
 * The frame is sandboxed without the app's origin and without the right to run
 * scripts, so the document in it can reach neither the app nor the session; a
 * document of its own is passed through as it is, and a fragment is wrapped in
 * a shell that gives it a page to sit on, so markup that never named a colour
 * is dark on paper rather than unreadable on the panel.
 *
 * A value that is markup is not trusted just because it is markup: it may have
 * been read out of a database, and a document that arrived that way can carry a
 * payload of its own. With scripts off, the frame draws the markup and nothing
 * more, so what the value says is the whole of what is shown: the reading draws
 * it, and does not touch it.
 */
const ResultHtml = ({value}) => {
  const intl = useIntl()
  const markup = htmlOf(value)

  return (
    <div className='html-view'>
      <iframe
        className='html-view__frame'
        title={intl.formatMessage({id: 'result.html_frame'})}
        sandbox=''
        srcDoc={htmlDocument(markup === null ? '' : markup)}
      />
    </div>
  )
}

ResultHtml.propTypes = {
  value: PropTypes.any,
}

export default ResultHtml
