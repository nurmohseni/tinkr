import {Controller, useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

const TagSelector = () => {
  const intl = useIntl()
  const {control} = useFormContext()

  return (
    <Controller
      name='tag'
      control={control}
      defaultValue='local'
      render={({
        field: {value, onChange},
      }) => (
        <select
          className='select'
          id='connection-tag'
          style={{width: '100%'}}
          value={value}
          onChange={event => onChange(event.target.value)}
        >
          <option value='local'>{intl.formatMessage({id: 'connections.tag_local'})}</option>
          <option value='testing'>{intl.formatMessage({id: 'connections.tag_testing'})}</option>
          <option value='development'>{intl.formatMessage({id: 'connections.tag_development'})}</option>
          <option value='staging'>{intl.formatMessage({id: 'connections.tag_staging'})}</option>
          <option value='production'>{intl.formatMessage({id: 'connections.tag_production'})}</option>
        </select>
      )}
    />
  )
}

export default TagSelector
