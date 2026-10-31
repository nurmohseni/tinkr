import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'

import QueryPlan from '../QueryPlan'
import english from '../../../../../tinkr-main/src/lang/en.json'

global.React = React

const render = plan => renderToStaticMarkup(
  <IntlProvider locale='en' messages={flatten(english)}>
    <QueryPlan plan={plan}/>
  </IntlProvider>,
)

describe('a query plan under its row', () => {
  test('nothing is drawn before the plan is asked for', () => {
    expect(render(null)).toBe('')
  })

  test('a plan being read says so', () => {
    expect(render({status: 'loading'})).toContain('Reading the plan…')
    expect(render({status: 'loading'})).toContain('aria-live="polite"')
  })

  test('a plan that could not be read says why, inline', () => {
    const markup = render({status: 'error', message: 'the session is not available, try reconnecting'})

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('the session is not available, try reconnecting')
  })

  test('sqlite steps are a table of the columns the driver named, with the driver under it', () => {
    const markup = render({
      status: 'ready',
      driver: 'sqlite',
      rows: [
        {id: 2, parent: 0, notused: 0, detail: 'SCAN orders'},
        {id: 3, parent: 0, notused: 0, detail: 'SEARCH orders USING INDEX'},
      ],
    })

    expect(markup).toContain('<th scope="col">id</th>')
    expect(markup).toContain('<th scope="col">detail</th>')
    expect(markup).toContain('SCAN orders')
    expect(markup).toContain('Plan from sqlite')
  })

  test('a driver that answered with no step says the plan is empty', () => {
    expect(render({status: 'ready', rows: []})).toContain('The plan is empty.')
  })
})
