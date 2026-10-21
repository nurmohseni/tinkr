import {useIntl} from 'react-intl'
import {useFormContext} from 'react-hook-form'

import Field from '../Field'
import {selectDirectory} from '../../utils/api'

const BrowseIcon = () => (
  <svg
    width='14'
    height='14'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinejoin='round'
  >
    <path d='M1.5 4.2A1.2 1.2 0 012.7 3h2.9l1.4 1.6h6.3A1.2 1.2 0 0114.5 5.8v6A1.2 1.2 0 0113.3 13H2.7a1.2 1.2 0 01-1.2-1.2z'/>
  </svg>
)

/**
 * The project path, with the directory picker set into the end of the field. An
 * SSH connection reaches a remote path, so the picker is only offered for a
 * project on this machine.
 *
 * A Laravel Cloud connection has no use for a path: its code runs in the
 * environment, not in a directory here. What the path is then is a local copy of
 * the same project, which is read for the class names the editor completes from,
 * so the line under the field says so and the field stays optional.
 */
const PathField = () => {
  const intl = useIntl()
  const {watch, setValue, register} = useFormContext()

  const isOverSSH = watch('is_over_ssh')
  const isCloud = watch('is_cloud')
  const pick = intl.formatMessage({id: 'connections.select_directory'})

  return (
    <Field
      label={intl.formatMessage({id: 'connections.path'})}
      htmlFor='connection-path'
    >
      <div className='well'>
        <input
          className='well__input input--mono'
          id='connection-path'
          name='path'
          type='text'
          placeholder={isCloud ? undefined : '/var/www/html'}
          spellCheck={false}
          autoComplete='off'
          {...register('path')}
        />

        {!isOverSSH && (
          <button
            className='well__action'
            type='button'
            title={pick}
            aria-label={pick}
            onClick={() => {
              const picked = selectDirectory()

              // a picker closed without choosing answers nothing, and the path
              // that was there is still the path
              if (picked) {
                setValue('path', picked, {shouldDirty: true})
              }
            }}
          >
            <BrowseIcon/>
          </button>
        )}
      </div>

      {isCloud && (
        <p className='cfield__note'>
          {intl.formatMessage({id: 'connections.path_cloud_hint'})}
        </p>
      )}
    </Field>
  )
}

export default PathField
