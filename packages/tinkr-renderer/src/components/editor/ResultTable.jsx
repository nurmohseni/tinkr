import PropTypes from 'prop-types'
import {useState} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'

import PointerMenu from '../PointerMenu'
import {copyText} from '../../utils/clipboard'
import {toPhpArray} from '../../utils/phpArray'
import {cellOf, compositeText, tableOf, toCsv} from '../../utils/resultReading'

/**
 * The table reading of a value: a list of records as its rows and columns,
 * which is what a query answers and what a collection json-encodes.
 *
 * The columns are the keys every row names, in the order the rows first name
 * them, so a row that carries an extra key still gets its column. The rows are
 * drawn a window at a time — the pane is short — but a row's actions and the
 * csv export carry the row whole.
 *
 * It takes a value `tableOf` accepts: the reading is chosen for the value
 * before this is drawn, and a value that is not a table is never read as one.
 *
 * @param {Array} value
 */
const ResultTable = ({value}) => {
  const intl = useIntl()
  const [menu, setMenu] = useState(null)
  const {columns, shown, more} = tableOf(value)

  const openMenu = (index, event) => {
    event.preventDefault()
    setMenu({index, at: {left: event.clientX, top: event.clientY}})
  }

  const row = menu ? shown[menu.index] : null

  return (
    <div className='result-table'>
      <table className='qtable qtable--values'>
        <thead>
          <tr>
            <th scope='col' className='qtable__index'>#</th>
            {columns.map(name => <th key={name} scope='col'>{name}</th>)}
          </tr>
        </thead>

        <tbody>
          {shown.map((item, index) => (
            <tr key={index} onContextMenu={event => openMenu(index, event)}>
              <td className='qtable__index'>
                <span className='qtable__index-cell'>
                  <span className='muted'>{index}</span>
                  <button
                    className='qtable__menu'
                    type='button'
                    title={intl.formatMessage({id: 'result.row_actions'}, {row: index})}
                    aria-label={intl.formatMessage({id: 'result.row_actions'}, {row: index})}
                    onClick={event => openMenu(index, event)}
                  >
                    …
                  </button>
                </span>
              </td>

              {columns.map(name => {
                const cell = cellOf(item[name])

                return (
                  <td key={name} className={cell.kind === 'number' ? 'num' : undefined}>
                    <span
                      className={`qtable__cell ${cell.className}`}
                      title={cell.cut ? cell.full : undefined}
                    >
                      {cell.kind === 'composite' ? compositeText(intl, item[name]) : cell.text}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {more > 0 && (
        <p className='result-table__more muted'>
          <FormattedMessage id='result.more_rows' values={{count: more}}/>
        </p>
      )}

      {menu && (
        <PointerMenu
          at={menu.at}
          label={intl.formatMessage({id: 'result.row_actions'}, {row: menu.index})}
          onClose={() => setMenu(null)}
        >
          {[
            ['result.copy_row_json', () => JSON.stringify(row, null, 2)],
            ['result.copy_row_php', () => toPhpArray(row)],
            ['result.copy_row_csv', () => toCsv(columns, [row])],
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
    </div>
  )
}

ResultTable.propTypes = {
  value: PropTypes.array.isRequired,
}

export default ResultTable
