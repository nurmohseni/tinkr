import PropTypes from 'prop-types'
import {FormattedMessage, useIntl} from 'react-intl'

import {changesReport, valueText} from '../../utils/changesReport'
import {isComposite, scalarClass} from '../../utils/resultReading'

/**
 * What a guarded run changed, under the guard's own report.
 *
 * A dry run is read as what it would have done, and the sentence above this says
 * the transaction was taken back; this is the part that says what it took back.
 * The rows are grouped by table, and each change is read the way a diff is: the
 * operation as a word, the key, then one `column before → after` per column it
 * touched. A created row has no before and a deleted row no after, so each is
 * written from the side it has.
 *
 * The list is capped where it is collected, and the count above it is not: a run
 * that changed more than the pane is given says how many there were. The writes
 * the report could not describe — a raw `update`, a query-builder delete, a
 * truncate — are said at the end with the first few as they were sent, because a
 * dry run that quietly leaves them out is a dry run that lies about its own
 * coverage.
 *
 * Nothing is drawn for a run that changed nothing, or for a run that was not
 * guarded at all: there is no transaction to report.
 */
const ResultChanges = ({transaction}) => {
  const intl = useIntl()
  const report = changesReport(transaction)

  if (!report) {
    return null
  }

  return (
    <section className='changes' aria-label={intl.formatMessage({id: 'guard.changes'})}>
      <div className='changes__head'>
        <span className='badge'>
          <FormattedMessage id='guard.changes'/>
        </span>
        <span className='nums'>
          {intl.formatMessage({id: 'guard.changes_count'}, {count: report.total})}
        </span>
        {report.cut && (
          <span className='muted nums'>
            {intl.formatMessage({id: 'guard.changes_shown'}, {shown: report.shown, total: report.total})}
          </span>
        )}
      </div>

      {report.groups.map(group => (
        <div className='changes__group' key={`${group.connection || ''}:${group.table}`}>
          <div className='changes__table'>
            <span className='mono changes__table-name'>{group.table}</span>
            <span className='muted nums'>
              {intl.formatMessage({id: 'guard.changes_rows'}, {count: group.rows.length})}
            </span>
            {group.connection !== transaction.connection && (
              <span className='muted'>
                {intl.formatMessage({id: 'guard.changes_on'}, {connection: group.connection || ''})}
              </span>
            )}
          </div>

          {group.rows.map((row, index) => (
            <div className='changes__row' key={index}>
              <span className='changes__op'>
                {intl.formatMessage({id: `guard.op_${row.op}`})}
              </span>
              <span className='changes__key mono'>{row.key || '—'}</span>
              <span className='changes__cols'>
                {row.columns.map(column => (
                  <span className='changes__col' key={column.name}>
                    <span className='mono changes__column'>{column.name}</span>
                    {row.op !== 'created' && <Value value={column.before}/>}
                    {row.op === 'updated' && <span className='changes__arrow'>{'→'}</span>}
                    {row.op !== 'deleted' && <Value value={column.after}/>}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}

      {report.undiffed && (
        <div className='changes__undiffed'>
          <span className='changes__note'>
            {intl.formatMessage({id: 'guard.changes_undiffed'}, {count: report.undiffed.count})}
          </span>
          {report.undiffed.sample.map((sql, index) => (
            <code key={index} className='changes__sql mono'>{sql}</code>
          ))}
        </div>
      )}
    </section>
  )
}

/** One value of a change, in the value tree's own type colours. */
const Value = ({value}) => (
  <span className={`mono ${isComposite(value) ? 't-string' : scalarClass(value)}`}>{valueText(value)}</span>
)

Value.propTypes = {
  value: PropTypes.any,
}

ResultChanges.propTypes = {
  transaction: PropTypes.object,
}

export default ResultChanges
