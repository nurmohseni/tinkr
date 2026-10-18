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
  const {register, watch} = useFormContext()

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
          placeholder={intl.formatMessage({id: 'connections.name_default'})}
          spellCheck={false}
          autoComplete='off'
          {...register('name')}
        />
      </Field>

      <PathField/>

      {/* a container's command is built from what it runs in, so the field only
          shows for a connection that is not one: a command typed here for a
          container would be replaced the moment a container field changed */}
      <Field
        label={intl.formatMessage({id: 'connections.command'})}
        htmlFor='connection-command'
        hidden={Boolean(watch('container_engine'))}
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
