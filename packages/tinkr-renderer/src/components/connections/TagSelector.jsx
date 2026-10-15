import {Controller, useFormContext} from 'react-hook-form'

const TagSelector = () => {
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
          <option value='local'>local</option>
          <option value='testing'>testing</option>
          <option value='development'>development</option>
          <option value='staging'>staging</option>
          <option value='production'>production</option>
        </select>
      )}
    />
  )
}

export default TagSelector
