import PropTypes from 'prop-types'
import {useState} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'

import Outcome from '../Outcome'
import PointerMenu from '../PointerMenu'
import {copyText} from '../../utils/clipboard'
import {queryText, sqlCell, sqlText} from '../../utils/queryLog'
import {cellOf} from '../../utils/resultReading'

/**
 * What the last run sent the database: every query it executed, the line of the
 * snippet that sent it, the bindings it was given, what it took and the
 * connection it ran on.
 *
 * A run that sent no query is not a run that failed, so the pane says it sent
 * none and leaves the failure to the views around it.
 *
 * The list is what the capture holds — a hundred queries, two hundred kilobytes
 * — while the envelope carries the true total, so a run that sent more says how
 * many are not here instead of stopping at a quiet hundred. What the pane lists
 * is what it copies.
 *
 * The rows are numbered from one, as a log is: the first query is the first row,
 * and the line column says which statement of the snippet sent it. The columns
 * are named as the envelope carries them — line, sql, bindings, ms and
 * connection — and the sql is the one thing read as the statement it is: every
 * other column is metadata around it.
 *
 * @param {Object} result  the last run's envelope
 */
const Queries = ({result}) => {
  const intl = useIntl()
  const [menu, setMenu] = useState(null)
  const queries = (result && result.queries) || []

  const openMenu = (index, event) => {
    event.preventDefault()
    setMenu({index, at: {left: event.clientX, top: event.clientY}})
  }

  if (!queries.length) {
    return (
      <div className='empty empty--benign'>
        <Outcome kind='printed'/>
        <p><FormattedMessage id={result ? 'queries.none' : 'queries.no_run'}/></p>
      </div>
    )
  }

  // what the run sent minus what the capture kept: the pane says what it is not
  // showing, and says nothing when it is showing everything
  const missing = Math.max(0, ((result && result.queriesTotal) || 0) - queries.length)
  const ms = queries.reduce((total, query) => total + (query.time || 0), 0)
  const query = menu ? queries[menu.index] : null

  return (
    <>
      <div className='result-summary result-summary--head'>
        <span>
          <FormattedMessage
            id='queries.sent'
            values={{
              // the count is the plural's own argument: it is passed as the
              // number it is, so the message picks its form and formats the #
              // with the locale
              count: queries.length,
              ms: intl.formatNumber(ms, {maximumFractionDigits: 2}),
            }}
          />
        </span>
        <span className='grow'/>

        <button
          className='btn btn--ghost btn--sm'
          type='button'
          title={intl.formatMessage({id: 'queries.copy_sql'})}
          onClick={() => copyText(sqlText(queries))}
        >
          <FormattedMessage id='queries.copy_sql'/>
        </button>
      </div>

      <table className='qtable qtable--values'>
        <thead>
          <tr>
            <th scope='col' className='qtable__index'>#</th>
            <th scope='col'><FormattedMessage id='queries.col_line'/></th>
            <th scope='col'><FormattedMessage id='queries.col_sql'/></th>
            <th scope='col'><FormattedMessage id='queries.col_bindings'/></th>
            <th scope='col'><FormattedMessage id='queries.col_ms'/></th>
            <th scope='col'><FormattedMessage id='queries.col_connection'/></th>
          </tr>
        </thead>

        <tbody>
          {queries.map((sent, index) => {
            const sql = sqlCell(sent.sql)
            const bindings = cellOf(JSON.stringify(sent.bindings || []))

            return (
              <tr key={index} onContextMenu={event => openMenu(index, event)}>
                <td className='qtable__index'>
                  <span className='qtable__index-cell'>
                    <span className='muted'>{index + 1}</span>
                    <button
                      className='qtable__menu'
                      type='button'
                      title={intl.formatMessage({id: 'queries.row_actions'}, {row: index + 1})}
                      aria-label={intl.formatMessage({id: 'queries.row_actions'}, {row: index + 1})}
                      onClick={event => openMenu(index, event)}
                    >
                      …
                    </button>
                  </span>
                </td>

                <td className='num'>
                  <span className='qtable__cell'>{sent.line}</span>
                </td>

                <td className='sql'>
                  <span className='qtable__cell' title={sql.cut ? sent.sql : undefined}>
                    {sql.text}
                  </span>
                </td>

                <td>
                  <span className='qtable__cell' title={bindings.cut ? bindings.full : undefined}>
                    {bindings.text}
                  </span>
                </td>

                <td className='num'>
                  <span className='qtable__cell'>{sent.time}</span>
                </td>

                <td>
                  <span className='qtable__cell'>{sent.connection}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {missing > 0 && (
        <p className='result-table__more muted'>
          <FormattedMessage id='queries.more' values={{count: missing}}/>
        </p>
      )}

      {menu && (
        <PointerMenu
          at={menu.at}
          label={intl.formatMessage({id: 'queries.row_actions'}, {row: menu.index + 1})}
          onClose={() => setMenu(null)}
        >
          {[
            ['result.copy_row_json', () => queryText(query)],
            ['queries.copy_sql', () => sqlText([query])],
          ].map(([id, textOf]) => (
            <button
              key={id}
              className='autocomplete__item'
              type='button'
              role='menuitem'
              onClick={() => {
                copyText(textOf())
                setMenu(null)
              }}
            >
              <FormattedMessage id={id}/>
            </button>
          ))}
        </PointerMenu>
      )}
    </>
  )
}

Queries.propTypes = {
  // the pane is drawn before the first run as well, when there is no envelope
  result: PropTypes.shape({
    queries: PropTypes.array,
    queriesTotal: PropTypes.number,
  }),
}

export default Queries
