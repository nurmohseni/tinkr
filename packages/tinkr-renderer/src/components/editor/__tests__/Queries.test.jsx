import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'

import Queries from '../Queries'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

// the pane's words are messages like the rest of the app's, so it is rendered
// inside the same provider the app gives it, with the english the app ships
const render = result => renderToStaticMarkup(
  <IntlProvider locale='en' messages={flatten(english)}>
    <Queries result={result}/>
  </IntlProvider>,
)

const sent = [
  {line: 1, sql: 'select 1 as n', bindings: [], time: 1.82, connection: 'mysql'},
  {line: 7, sql: 'select * from orders where id = ?', bindings: [12], time: 0.4, connection: 'mysql'},
]

describe('the queries pane', () => {
  test('a pane with no run asks for one', () => {
    expect(render(null)).toContain('Run the snippet to see the queries it sends.')
  })

  test('a run that sent no query says it sent none', () => {
    const markup = render({value: 3, error: null, output: '', queries: [], queriesTotal: 0})

    expect(markup).toContain('The run sent no query.')
    expect(markup).toContain('empty--benign')
  })

  test('the strip counts the queries and adds up what they took', () => {
    const markup = render({queries: sent, queriesTotal: 2})

    expect(markup).toContain('2 queries in 2.22 ms')
  })

  test('a row carries the statement, the line that sent it, its bindings, its time and its connection', () => {
    const markup = render({queries: sent, queriesTotal: 2})

    expect(markup).toContain('select * from orders where id = ?')
    expect(markup).toContain('<span class="muted">1</span>')
    expect(markup).toContain('<span class="muted">2</span>')
    expect(markup).toContain('>1.82<')
    expect(markup).toContain('&quot;[12]&quot;')
    expect(markup).toContain('mysql')
  })

  test('the columns are the names the envelope carries', () => {
    const markup = render({queries: sent, queriesTotal: 2})

    expect(markup).toContain('>line</th>')
    expect(markup).toContain('>sql</th>')
    expect(markup).toContain('>bindings</th>')
    expect(markup).toContain('>ms</th>')
    expect(markup).toContain('>connection</th>')
  })

  test('a statement longer than a cell shows is cut, and the whole of it is the cell title', () => {
    const sql = `select ${'coalesce(a, b), '.repeat(20)}id from orders`
    const markup = render({queries: [{...sent[0], sql}], queriesTotal: 1})

    expect(markup).toContain(`${sql.slice(0, 120)}…`)
    expect(markup).toContain(`title="${sql}"`)
  })

  test('a run that sent more than the capture holds says how many are missing', () => {
    const markup = render({queries: sent, queriesTotal: 150})

    expect(markup).toContain('+148 more queries, not captured')
  })

  test('a run the capture holds in full says nothing about missing queries', () => {
    const markup = render({queries: sent, queriesTotal: 2})

    expect(markup).not.toContain('not captured')
  })

  test('the whole log copies, and each row copies on its own', () => {
    const markup = render({queries: sent, queriesTotal: 2})

    expect(markup).toContain('Copy SQL')
    expect(markup).toContain('aria-label="Actions for query 1"')
    expect(markup).toContain('aria-label="Actions for query 2"')
  })
})
