import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {createStore, Provider} from 'jotai'
import flatten from 'flat'

import MutationConfirm from '../MutationConfirm'
import {connectionAtom, mutationGateAtom} from '../../../stores/editor'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

// the box is portalled to the body, which a server render cannot do, so it is
// rendered into a document and read back from there. `press` is a selector,
// because both answers are buttons and the store is the only place the answer
// shows — the run the box sends has to be observed from the outside
const render = (held, press) => {
  const store = createStore()

  store.set(connectionAtom, {name: 'orders', tag: 'production'})
  store.set(mutationGateAtom, held)

  window.api.runConnection.mockClear()

  const host = document.createElement('div')

  document.body.appendChild(host)

  ReactDOM.render(
    <Provider store={store}>
      <IntlProvider locale='en' messages={flatten(english)}>
        <MutationConfirm/>
      </IntlProvider>
    </Provider>,
    host,
  )

  if (press) {
    // the box is portalled to the body, so it is the body the buttons are in
    // rather than the host the tree was rendered into
    document.body.querySelector(press).click()
  }

  const markup = document.body.innerHTML

  ReactDOM.unmountComponentAtNode(host)
  host.remove()

  return {markup, store}
}

const held = {
  code: '$order->save();',
  guard: null,
  writes: [{line: 1, call: 'save'}, {line: 4, call: 'delete from'}],
}

describe('the box a held run is asked about', () => {
  test('says nothing when no run is waiting', () => {
    expect(render(null).markup).not.toContain('modal')
  })

  test('names the connection the run would have been sent to', () => {
    const {markup} = render(held)

    expect(markup).toContain('This run changes the database')
    expect(markup).toContain('The connection orders is tagged production.')
  })

  test('shows every call the scan found, each with its line', () => {
    const {markup} = render(held)

    expect(markup).toContain('<strong>save</strong>')
    expect(markup).toContain('<strong>delete from</strong>')
    expect(markup).toContain(' line 1')
    expect(markup).toContain(' line 4')
  })

  test('sends the held run, and nothing else, when it is allowed through', () => {
    const {store} = render(held, '.btn--primary')

    expect(window.api.runConnection.mock.calls).toEqual([['$order->save();', null]])
    expect(store.get(mutationGateAtom)).toBe(null)
  })

  test('sends the held run under the guard it was held with', () => {
    render({...held, guard: 'commit'}, '.btn--primary')

    expect(window.api.runConnection.mock.calls).toEqual([['$order->save();', 'commit']])
  })

  test('sends nothing, and clears the box, when it is dropped', () => {
    // the box itself follows the gate: a component with no run waiting renders
    // nothing at all, which is the first test above. What is left to prove here
    // is that both the run and the question are gone
    const {store} = render(held, '.btn--ghost')

    expect(window.api.runConnection.mock.calls).toEqual([])
    expect(store.get(mutationGateAtom)).toBe(null)
  })
})
