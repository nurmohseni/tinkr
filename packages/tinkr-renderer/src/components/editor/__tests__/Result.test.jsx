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
const render = (result, view) => renderToStaticMarkup(
  <IntlProvider locale='en' messages={flatten(english)}>
    <Result result={result} view={view} onView={() => {}}/>
  </IntlProvider>,
)

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
})
