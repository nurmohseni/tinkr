import PropTypes from 'prop-types'

/**
 * One line of the connection form: the label on the shared label column, the
 * control after it. The row is `.form-row` (display: contents), so both land in
 * the `.form-grid` grid that ConnectionForm draws; the connection form is the
 * only place it is used.
 */
const Field = ({label, htmlFor, hidden, children}) => (
  <div className='form-row' hidden={hidden || undefined}>
    <label
      className='form-row__label'
      htmlFor={htmlFor}
    >
      {label}
    </label>

    <div className='form-row__control'>
      {children}
    </div>
  </div>
)

Field.propTypes = {
  label: PropTypes.node.isRequired,
  htmlFor: PropTypes.string.isRequired,
  // a row that belongs to another kind of connection, and is not shown for this
  // one: the control stays in the form, so its value travels with the save
  hidden: PropTypes.bool,
  children: PropTypes.node.isRequired,
}

export default Field
