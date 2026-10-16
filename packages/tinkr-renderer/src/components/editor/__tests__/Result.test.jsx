import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'

import Result from '../Result'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

// the pane's words are messages like the rest of the app's, so it is rendered
// inside the same provider the app gives it, with the english the app ships
const render = (result, view, allStatements = false, onKeep = () => {}) => renderToStaticMarkup(
  <IntlProvider locale='en' messages={flatten(english)}>
    <Result result={result} view={view} onView={() => {}} onKeep={onKeep} allStatements={allStatements}/>
  </IntlProvider>,
)

// a reading is offered as a radio in a label, so the switch shows it as the word
// that label ends with
const offers = (markup, reading) => markup.includes(`/>${reading}</label>`)

describe('the result panel', () => {
  test('a run that returned a value says what it aliased', () => {
    const markup = render({
      value: 3,
      error: null,
      output: '',
      imported: {Order: 'App\\Models\\Order', Invoice: 'App\\Models\\Invoice'},
    })

    expect(markup).toContain('imported')
    expect(markup).toContain('Order')
    expect(markup).toContain('App\\Models\\Order')
    expect(markup).toContain('App\\Models\\Invoice')
    expect(markup).toContain('returned')
  })

  test('a run that threw still says what it aliased', () => {
    const markup = render({
      value: null,
      error: {class: 'Error', message: 'Class "Something" not found'},
      output: '',
      imported: {Order: 'App\\Models\\Order'},
    })

    expect(markup).toContain('imported')
    expect(markup).toContain('App\\Models\\Order')
    expect(markup).toContain('threw')
  })

  test('a run that printed still says what it aliased', () => {
    const markup = render({
      value: null,
      error: null,
      output: 'array:1 [\n  0 => "a"\n]',
      imported: {Order: 'App\\Models\\Order'},
    })

    expect(markup).toContain('imported')
    expect(markup).toContain('App\\Models\\Order')
    expect(markup).toContain('array:1')
  })

  test('reads a value as a tree, and as the json it is drawn from', () => {
    const result = {value: {name: 'noor', items: [1, 2]}, error: null, output: '', imported: {}}
    const organized = render(result, 'organized')
    const raw = render(result, 'raw')

    // the tree, node by node
    expect(organized).toContain('tree__row')
    expect(organized).toContain('name')
    // and the text it is drawn from
    expect(organized).not.toContain('&quot;name&quot;')
    expect(raw).not.toContain('tree__row')
    expect(raw).toContain('&quot;name&quot;')
    expect(raw).toContain('noor')
    // both readings are offered, and one of them is on
    expect(organized).toContain('organized')
    expect(organized).toContain('raw')
    expect(raw).toContain('checked=""')
  })

  test('reads a run that only printed as it printed, with nothing to switch to', () => {
    const result = {value: null, error: null, output: 'array:1 [\n  0 => "a"\n]', imported: {}}

    expect(render(result, 'raw')).toContain('array:1')
    expect(render(result, 'raw')).not.toContain('view-switch')
    expect(render(result, 'organized')).toContain('array:1')
  })

  test('reads a value one way or the other, never both at once', () => {
    // dump() both prints its value and returns it, which is what a `dump`
    // snippet does: the readings replace each other
    const result = {
      value: {a: 1},
      error: null,
      output: 'array:1 [\n  "a" => 1\n]',
      imported: {},
    }

    const organized = render(result, 'organized')
    const raw = render(result, 'raw')

    // organized is the tree, and the session's own words are not above it
    expect(organized).toContain('tree__row')
    expect(organized).not.toContain('array:1 [')
    expect(organized).not.toContain('printed')

    // raw is those words, and the tree is not under them
    expect(raw).toContain('array:1 [')
    expect(raw).not.toContain('tree__row')
    expect(raw).toContain('view-switch')
  })

  test('reads a value that was not printed raw as the json it is drawn from', () => {
    const result = {value: {a: 1}, error: null, output: '', imported: {}}
    const raw = render(result, 'raw')

    expect(raw).toContain('&quot;a&quot;')
    expect(raw).not.toContain('tree__row')
  })

  test('says nothing when the run aliased nothing', () => {
    expect(render({value: 1, error: null, output: '', imported: {}})).not.toContain('imported')
    expect(render({value: 1, error: null, output: ''})).not.toContain('imported')
  })

  test('reads a list of records as a table: a column per key, a row per record', () => {
    const result = {value: [{id: 1, name: 'Ada'}, {id: 2, name: 'Bob'}], error: null, output: '', imported: {}}

    // the reading is offered by a switch that says which one is showing
    expect(offers(render(result, 'organized'), 'table')).toBe(true)

    const table = render(result, 'table')

    expect(table).toContain('qtable--values')
    expect(table).toContain('scope="col"')
    expect(table).toContain('name')
    expect(table).toContain('Ada')
    expect(table).toContain('Bob')
    expect(table).toContain('2 items')
    expect(table).not.toContain('tree__row')
    // the rows can be copied out, which the tree's rows cannot
    expect(table).toContain('qtable__menu')
  })

  test('reads a value as a graph: a mark per path, joined to what holds it', () => {
    const result = {value: {app: {name: 'Tinkr'}, users: [{id: 1}]}, error: null, output: '', imported: {}}

    expect(offers(render(result, 'organized'), 'graph')).toBe(true)

    const graph = render(result, 'graph')

    expect(graph).toContain('graph__canvas')
    expect(graph).toContain('<circle')
    expect(graph).toContain('graph__edge')
    expect(graph).toContain('users')
    expect(graph).not.toContain('tree__row')
    expect(graph).not.toContain('NaN')
  })

  test('reads a value that is markup as the document it is', () => {
    const result = {value: '<p>hello</p>', error: null, output: '', imported: {}}

    expect(offers(render(result, 'organized'), 'html')).toBe(true)

    const html = render(result, 'html')

    expect(html).toContain('html-view__frame')
    // the document is handed to the frame itself, whole, not read to it
    expect(html).toContain('srcDoc="&lt;!doctype html&gt;')
    // and the frame runs nothing of the app's
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).toContain('title="The rendered document"')
    expect(html).not.toContain('tree__row')
  })

  test('draws the tree where a value has no such reading, never an empty pane', () => {
    const result = {value: 5, error: null, output: 'printed', imported: {}}

    // 5 has no table to show, so asking for one shows 5
    expect(offers(render(result, 'organized'), 'table')).toBe(false)
    expect(render(result, 'table')).toContain('tree__row')
  })

  test('offers the readings of every statement a run made, and reads each of them', () => {
    const result = {
      value: [{id: 1}],
      error: null,
      output: '',
      imported: {},
      blocks: [
        {line: 1, value: [{id: 1}], error: null},
        {line: 2, value: 'printed', error: null},
      ],
    }

    // a run is read as one value unless the app asks for it statement by statement
    expect(render(result, 'table')).not.toContain('2 statements')

    const table = render(result, 'table', true)

    expect(table).toContain('2 statements')
    expect(offers(table, 'table')).toBe(true)
    // the statement that returned records is a table, the one that returned a
    // string keeps its tree
    expect(table).toContain('qtable--values')
    expect(table).toContain('tree__row')
  })
})

describe('the transaction guard', () => {
  const transaction = over => Object.assign({
    mode: 'rollback',
    armed: true,
    connection: 'mysql',
    statements: 3,
    outcome: 'rolledBack',
    error: null,
  }, over)

  const reading = over => render(
    {value: null, error: null, output: '', imported: {}, transaction: transaction(over)},
    'organized',
  )

  test('says nothing where no guard was asked for', () => {
    const run = render({value: 3, error: null, output: '', imported: {}}, 'organized')

    expect(run).not.toContain('Rolled back')
    expect(run).not.toContain('Run again and keep')
  })

  test('reads a dry run as a run that was taken back, and offers to keep it', () => {
    const markup = reading()

    expect(markup).toContain('Rolled back 3 statements on mysql')
    // the offer to keep it is on the line that says it was not kept
    expect(markup).toContain('Run again and keep')
    expect(markup).toContain('Run the same code again, this time keeping the transaction')
  })

  test('reads a run that was kept as kept', () => {
    const markup = reading({mode: 'commit', outcome: 'committed'})

    expect(markup).toContain('Committed 3 statements on mysql')
    // there is nothing to run again: what it did was kept
    expect(markup).not.toContain('Run again and keep')
    expect(markup).not.toContain('Rolled back')
  })

  test('counts one statement in the singular, and none as nothing to keep', () => {
    expect(reading({statements: 1})).toContain('Rolled back 1 statement on mysql')
    // a run that sent nothing has nothing the keeping of which could be offered
    expect(reading({statements: 0})).not.toContain('Run again and keep')
  })

  test('reads a transaction that could not be closed as the failure it is', () => {
    const markup = reading({outcome: 'failed', error: 'gone away'})

    expect(markup).toContain('The transaction on mysql could not be closed: gone away')
    expect(markup).not.toContain('Run again and keep')
  })

  test('reads a guard that never armed as a run that did not happen', () => {
    const markup = reading({armed: false, connection: null, statements: 0, outcome: 'failed'})

    expect(markup).toContain('Nothing was run')
    expect(markup).not.toContain('Run again and keep')
  })
})
