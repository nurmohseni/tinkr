import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import {Provider, createStore} from 'jotai'
import flatten from 'flat'

import DryRunButton from '../DryRunButton'
import {dryRunAtom, sandboxAtom} from '../../../stores/editor'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

// the switch reads and writes the atoms the run reads, so a test renders it
// inside a store it can set itself
const render = (dryRun, sandbox = true) => {
  const store = createStore()

  store.set(dryRunAtom, dryRun)
  store.set(sandboxAtom, sandbox)

  return renderToStaticMarkup(
    <IntlProvider locale='en' messages={flatten(english)}>
      <Provider store={store}>
        <DryRunButton/>
      </Provider>
    </IntlProvider>,
  )
}

describe('the dry run switch', () => {
  test('wears the guard it is in: a run inside a transaction, or one outside it', () => {
    // the transaction around the run
    expect(render(true)).toContain('<rect x="2.6" y="3.2"')
    // what the transaction holds, against what is not held at all
    expect(render(true)).toContain('<circle')
    expect(render(true)).not.toContain('M3.4 12.6')

    expect(render(false)).toContain('<rect x="2.6" y="3.2"')
    expect(render(false)).toContain('M3.4 12.6')
    expect(render(false)).not.toContain('<circle')
  })

  test('shows a sealed world when the sandbox is on, and the plain one when it is not', () => {
    // the shackle is the difference: a run whose world is sealed says so, and
    // one that is only inside a transaction does not
    expect(render(true, true)).toContain('M5.4 6.2V5a2.6')
    expect(render(true, false)).not.toContain('M5.4 6.2V5a2.6')
    expect(render(true, false)).toContain('<circle')
  })

  test('says which way the next click takes it', () => {
    // the first click turns the dry run on, and after that the click is about
    // the sandbox — which is the part a dry run does not have by itself
    expect(render(false)).toContain('Turn on dry run')
    expect(render(true, true)).toContain('Turn off the sandbox')
    expect(render(true, false)).toContain('Turn on the sandbox')
  })

  test('is a switch, and says which way it is set', () => {
    expect(render(false)).toContain('aria-pressed="false"')
    expect(render(true)).toContain('aria-pressed="true"')
    // the glyph is the state, so it carries no text of its own
    expect(render(true)).not.toContain('Dry run</button>')
  })
})
