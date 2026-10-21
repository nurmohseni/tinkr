import PropTypes from 'prop-types'

/**
 * One line of a connection dialog's section: the label on the section's label
 * column, the control after it. The connection form is the only place it is
 * used.
 *
 * A control that is a group of radios has no element a `<label>` can point at,
 * so the row names it with `labelId` instead: the label is then a plain span
 * the group reads as its name through `aria-labelledby`.
 */
const Field = ({label, htmlFor, labelId, hidden, children}) => (
  <div className='cfield' hidden={hidden || undefined}>
    {labelId
      ? <span id={labelId} className='cfield__label'>{label}</span>
      : <label className='cfield__label' htmlFor={htmlFor}>{label}</label>}

    <div className='cfield__control'>
      {children}
    </div>
  </div>
)

Field.propTypes = {
  label: PropTypes.node.isRequired,
  htmlFor: PropTypes.string,
  labelId: PropTypes.string,
  // a row that belongs to another kind of connection, and is not shown for this
  // one: the control stays in the form, so its value travels with the save
  hidden: PropTypes.bool,
  children: PropTypes.node.isRequired,
}

export default Field
