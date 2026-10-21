import PropTypes from 'prop-types'
import {useIntl} from 'react-intl'

import {stageOf} from '../../utils/stage'

/**
 * A connection's stage as a light: its tag's colour, with the tag's word as its
 * name, so a pointer finds the word and a screen reader reads it.
 */
const StageLight = ({tag}) => {
  const intl = useIntl()
  const stage = stageOf(tag)
  const word = intl.formatMessage({id: `connections.tag_${stage}`})

  return (
    <span
      className={`stage-dot stage--${stage}`}
      role='img'
      aria-label={word}
      title={word}
    />
  )
}

StageLight.propTypes = {
  tag: PropTypes.string,
}

export default StageLight
