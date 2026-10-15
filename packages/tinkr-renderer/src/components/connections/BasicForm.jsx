import {useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

import Field from '../Field'
import TagSelector from './TagSelector'
import PathField from './PathField'

/**
 * The connection's own fields, as the dialog's form rows: name, project path,
 * command and tag. The rows are direct children of ConnectionForm's grid.
 */
const BasicForm = () => {
  const intl = useIntl()
  const {register} = useFormContext()

  return (
    <>
      <Field
        label={intl.formatMessage({id: 'connections.name'})}
        htmlFor='connection-name'
      >
        <input
          className='input'
          id='connection-name'
          name='name'
          type='text'
          placeholder='Magic'
          spellCheck={false}
          autoComplete='off'
          {...register('name')}
        />
      </Field>

      <PathField/>

      <Field
        label={intl.formatMessage({id: 'connections.command'})}
        htmlFor='connection-command'
      >
        <input
          className='input'
          id='connection-command'
          name='command'
          type='text'
          placeholder='php artisan tinker'
          spellCheck={false}
          autoComplete='off'
          style={{fontFamily: 'var(--font-mono)'}}
          {...register('command')}
        />
      </Field>

      <Field
        label={intl.formatMessage({id: 'connections.tag'})}
        htmlFor='connection-tag'
      >
        <TagSelector/>
      </Field>
    </>
  )
}

export default BasicForm
