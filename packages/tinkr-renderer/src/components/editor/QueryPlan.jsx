import PropTypes from 'prop-types'
import {FormattedMessage} from 'react-intl'

import {planCell, planTable} from '../../utils/queryLog'

/**
 * The plan of one query, under the row it explains.
 *
 * What a driver answers is a table of its own steps — sqlite's `EXPLAIN QUERY
 * PLAN` has an `id`, a `parent` and a `detail`, MySQL's `EXPLAIN` has twelve
 * columns, and PostgreSQL's is one `QUERY PLAN` column whose value keeps its
 * lines. The columns are whatever the rows name, so the pane never assumes a
 * driver's shape; what a plan does not carry is said instead of drawn as an
 * empty table.
 *
 * The states are the request's: a wait, an error in the connection's own words,
 * or the plan. They live in one line under the row, so reading a plan moves
 * nothing above it.
 *
 * @param {Object} plan  `{status, driver, rows, message}`, or nothing before the
 *   request starts
 */
const QueryPlan = ({plan}) => {
  if (!plan) {
    return null
  }

  const table = plan.status === 'ready' ? planTable(plan.rows) : null

  return (
    <div className='plan' aria-live='polite'>
      {plan.status === 'loading' && (
        <p className='plan__note'>
          <FormattedMessage id='queries.explain_loading'/>
        </p>
      )}

      {plan.status === 'error' && (
        <p className='plan__note plan__note--error' role='alert'>{plan.message}</p>
      )}

      {plan.status === 'ready' && table.rows.length === 0 && (
        <p className='plan__note'>
          <FormattedMessage id='queries.explain_empty'/>
        </p>
      )}

      {plan.status === 'ready' && table.rows.length > 0 && (
        <table className='qtable plan__table'>
          <thead>
            <tr>
              {table.columns.map(column => (
                <th key={column} scope='col'>{column}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {table.columns.map(column => {
                  const cell = planCell(row[column])

                  return (
                    <td key={column}>
                      <span className='plan__cell' title={cell.cut ? cell.full : undefined}>
                        {cell.text}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {plan.status === 'ready' && plan.driver && (
        <p className='plan__source'>
          <FormattedMessage id='queries.explain_driver' values={{driver: plan.driver}}/>
        </p>
      )}
    </div>
  )
}

QueryPlan.propTypes = {
  plan: PropTypes.shape({
    status: PropTypes.oneOf(['loading', 'ready', 'error']).isRequired,
    driver: PropTypes.string,
    rows: PropTypes.array,
    message: PropTypes.string,
  }),
}

export default QueryPlan
