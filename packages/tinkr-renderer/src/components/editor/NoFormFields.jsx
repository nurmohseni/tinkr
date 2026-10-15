import PropTypes from 'prop-types'
import {useRoute} from 'wouter'
import {FormattedMessage} from 'react-intl'
import {useAtomValue} from 'jotai'
import useHashLocation from '../../utils/useHashLocation'

import {configAtom} from '../../stores/config'

const InfoIcon = () => (
  <svg width='14' height='14' viewBox='0 0 16 16' aria-hidden='true' fill='none' stroke='currentColor' strokeWidth='1.3'>
    <circle cx='8' cy='8' r='6.2'/>
    <path d='M8 4.8v4.4M8 11.4v.2' strokeLinecap='round'/>
  </svg>
)

/**
 * The form of a snippet that has no variables: the design's empty state, and
 * the way back to the code.
 *
 * When the snippet could not be read as a form at all, the parser's message
 * takes the empty state's place — an empty state would be a lie.
 */
const NoFormFields = ({error}) => {
  const config = useAtomValue(configAtom)
  const [, params] = useRoute('/snippets/:id/:mode')
  const [, setLocation] = useHashLocation()

  const openCode = () => setLocation(`/snippets/${params.id}/editor`)

  if (error) {
    return (
      <div style={{flex: '1 1 auto', minWidth: 0, alignSelf: 'flex-start', paddingTop: 'var(--s3)'}}>
        <div className='error-surface' role='alert'>
          <p className='error-surface__message mono'>{error}</p>
        </div>

        <button
          className='btn btn--secondary'
          type='button'
          style={{margin: '0 var(--s3)'}}
          onClick={openCode}
        >
          <FormattedMessage id='editor.form_edit_code'/>
        </button>
      </div>
    )
  }

  return (
    <div className='empty empty--benign' style={{flex: '1 1 auto', alignSelf: 'flex-start'}}>
      <span className='empty__icon' aria-hidden='true'>
        <InfoIcon/>
      </span>

      <div style={{minWidth: 0}}>
        <p>
          <FormattedMessage
            id='editor.form_no_fields'
            values={{
              prefix: config.form_prefix,
              // eslint-disable-next-line react/display-name
              code: chucks => <span className='mono' style={{fontSize: 'var(--fs-sm)'}}>{chucks}</span>,
            }}
          />
        </p>

        <button
          className='btn btn--secondary'
          type='button'
          style={{marginTop: 'var(--s3)'}}
          onClick={openCode}
        >
          <FormattedMessage id='editor.form_edit_code'/>
        </button>
      </div>
    </div>
  )
}

NoFormFields.propTypes = {
  error: PropTypes.string,
}

NoFormFields.defaultProps = {
  error: '',
}

export default NoFormFields
