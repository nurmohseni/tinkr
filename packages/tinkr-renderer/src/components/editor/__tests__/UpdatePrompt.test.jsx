import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {createStore, Provider} from 'jotai'
import flatten from 'flat'

import UpdatePrompt from '../UpdatePrompt'
import {updateStateAtom} from '../../../stores/update'
import english from '../../../../../tinkr-main/src/lang/en.json'

jest.mock('../../../utils/api', () => ({
  downloadUpdate: jest.fn(),
  installUpdate: jest.fn(),
}))

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

// the panel is portalled to the body, which a server render cannot do, so it is
// rendered into a document and read back from there
const render = state => {
  const store = createStore()

  store.set(updateStateAtom, state)

  const host = document.createElement('div')

  document.body.appendChild(host)

  ReactDOM.render(
    <Provider store={store}>
      <IntlProvider locale='en' messages={flatten(english)}>
        <UpdatePrompt/>
      </IntlProvider>
    </Provider>,
    host,
  )

  const markup = document.body.innerHTML

  ReactDOM.unmountComponentAtNode(host)
  host.remove()

  return markup
}

describe('the update prompt', () => {
  test('says nothing when the app is up to date', () => {
    expect(render({status: 'idle'})).not.toContain('modal')
  })

  test('offers a version it found, and downloads nothing by itself', () => {
    const markup = render({status: 'available', version: '0.2.0'})

    expect(markup).toContain('A new version is ready')
    expect(markup).toContain('0.2.0')
    expect(markup).toContain('Download')
    expect(markup).toContain('Later')
  })

  test('shows the download going, and asks for nothing while it does', () => {
    const markup = render({status: 'downloading', version: '0.2.0', percent: 42})

    expect(markup).toContain('A new version is ready')
    expect(markup).toContain('42')
    // the way out is the answer that was already given: no button to unask it
    expect(markup).toContain('<footer class="modal__footer"></footer>')
  })

  test('says when a downloaded update lands, and offers to do it now', () => {
    const markup = render({status: 'ready', version: '0.2.0'})

    expect(markup).toContain('The update is downloaded')
    expect(markup).toContain('when the app closes')
    expect(markup).toContain('Restart and install')
    expect(markup).toContain('>Later<')
  })

  test('says what went wrong with a download that did not finish', () => {
    const markup = render({status: 'failed', message: 'no answer from github'})

    expect(markup).toContain('The download did not finish')
    expect(markup).toContain('no answer from github')
    // nothing to press but the way out: the download failed, not the update
    expect(markup).not.toContain('btn btn--primary')
    expect(markup).toContain('>Later<')
  })
})
