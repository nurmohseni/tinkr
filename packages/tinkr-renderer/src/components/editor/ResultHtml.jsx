import PropTypes from 'prop-types'
import {useIntl} from 'react-intl'

import {htmlDocument} from '../../utils/resultReading'

/**
 * The html reading of a value: a string that is markup, drawn as a document is
 * drawn, which is how a dumped view or a mailable is read.
 *
 * The frame is sandboxed without the app's origin, so the document in it can
 * reach neither the app nor the session; a document of its own is passed
 * through as it is, and a fragment is wrapped in a shell that gives it a page
 * to sit on, so markup that never named a colour is dark on paper rather than
 * unreadable on the panel.
 *
 * The app's scripts never run in there, so what the value says is the whole of
 * what is shown: the reading draws it, and does not touch it.
 */
const ResultHtml = ({value}) => {
  const intl = useIntl()

  return (
    <div className='html-view'>
      <iframe
        className='html-view__frame'
        title={intl.formatMessage({id: 'result.html_frame'})}
        sandbox='allow-scripts'
        srcDoc={htmlDocument(value)}
      />
    </div>
  )
}

ResultHtml.propTypes = {
  value: PropTypes.any,
}

export default ResultHtml
