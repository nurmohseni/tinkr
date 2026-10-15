import {FormattedMessage, useIntl} from 'react-intl'
import {useFormContext} from 'react-hook-form'

import Field from '../Field'
import {selectDirectory} from '../../utils/api'

const BrowseIcon = () => (
  <svg
    width='12'
    height='12'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
  >
    <path d='M1.5 4.2A1.2 1.2 0 012.7 3h2.9l1.4 1.6h6.3A1.2 1.2 0 0114.5 5.8v6A1.2 1.2 0 0113.3 13H2.7a1.2 1.2 0 01-1.2-1.2z'/>
  </svg>
)

/**
 * The project path, with the directory picker next to it. An SSH connection
 * reaches a remote path, so the picker is only offered for a local app.
 */
const PathField = () => {
  const intl = useIntl()
  const {watch, setValue, register} = useFormContext()

  const isOverSSH = watch('is_over_ssh')

  return (
    <Field
      label={intl.formatMessage({id: 'connections.path'})}
      htmlFor='connection-path'
    >
      <div className='row'>
        <input
          className='input grow'
          id='connection-path'
          name='path'
          type='text'
          placeholder='/var/www/html'
          spellCheck={false}
          autoComplete='off'
          style={{fontFamily: 'var(--font-mono)'}}
          {...register('path')}
        />

        {!isOverSSH && (
          <button
            className='btn btn--secondary'
            type='button'
            title={intl.formatMessage({id: 'connections.select_directory'})}
            onClick={() => setValue('path', selectDirectory())}
          >
            <BrowseIcon/>
            <FormattedMessage id='connections.select_directory'/>
          </button>
        )}
      </div>
    </Field>
  )
}

export default PathField
