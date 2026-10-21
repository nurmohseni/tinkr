import PropTypes from 'prop-types'

/**
 * One stop on the connection's way in — the server, the container, the project —
 * as a titled group of rows. The sections are drawn in the order a session
 * reaches them, so reading the dialog top to bottom is reading the route.
 */
const Section = ({id, title, children}) => (
  <section
    className='csection'
    aria-labelledby={`${id}-title`}
  >
    <h3
      id={`${id}-title`}
      className='csection__title'
    >
      {title}
    </h3>

    <div className='csection__rows'>
      {children}
    </div>
  </section>
)

Section.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.node.isRequired,
  children: PropTypes.node.isRequired,
}

export default Section
