import PropTypes from 'prop-types'
import isArray from 'lodash/isArray'

/**
 * One field of the snippet's form, as a `.form-row` of the design's form grid:
 * the label in the left column, the control in the right one.
 *
 * The field comes from the snippet's code, so its type is whatever php-form
 * read out of the variable's annotation.
 */
const FormField = ({field, onChange}) => {
  const label = field.label || field.name
  const id = `form-field-${field.name}`

  const control = () => {
    switch (field.type) {
      case 'select':
        return (
          <select
            className='select'
            id={id}
            style={{width: '100%'}}
            value={field.value}
            onChange={event => onChange(event.target.value)}
          >
            {(isArray(field.options) ? field.options : []).map((option, index) => (
              <option
                key={`${field.name}_options_${index}`}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
        )
      case 'checkbox':
        return (
          <label className='checkbox'>
            <input
              type='checkbox'
              checked={field.value === 'true'}
              onChange={event => onChange(event.target.checked ? 'true' : 'false')}
            />
            <span className='checkbox__box'/>
            {field.description && <span>{field.description}</span>}
          </label>
        )
      case 'switch':
        return (
          <label className='switch'>
            <input
              type='checkbox'
              aria-label={label}
              checked={field.value === 'true'}
              onChange={event => onChange(event.target.checked ? 'true' : 'false')}
            />
            <span className='switch__track'/>
          </label>
        )
      case 'textarea':
        return (
          <textarea
            className='textarea'
            id={id}
            value={field.value}
            onChange={event => onChange(event.target.value)}
          />
        )
      default:
        return (
          <input
            className='input'
            id={id}
            type={field.type}
            value={field.value}
            onChange={event => onChange(event.target.value)}
          />
        )
    }
  }

  return (
    <div className='form-row'>
      <label className='form-row__label' htmlFor={id}>{label}</label>
      <div className='form-row__control field'>
        {control()}

        {field.description && field.type !== 'checkbox' && (
          <span className='field__help'>{field.description}</span>
        )}
      </div>
    </div>
  )
}

FormField.propTypes = {
  field: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
}

export default FormField
