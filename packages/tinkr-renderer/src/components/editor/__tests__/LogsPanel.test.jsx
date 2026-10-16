import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import {Provider, createStore} from 'jotai'
import flatten from 'flat'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

// the panel is drawn from the store the window has open, and reads nothing else
// itself, but the store's module reads window.api as it loads
window.api = {}

const english = require('../../../../../tinkr-main/src/lang/en.json')
const {logsAtom} = require('../../../stores/logs')
const LogsPanel = require('../LogsPanel').default

// the words this window adds, which the message files are given separately
const added = {
  'editor.logs_older': 'Older',
  'editor.logs_newer': 'Newer',
  'editor.logs_read_of_before': 'read {read} KB ending {back} KB before the end of {size} KB',
}

// the panel's words are messages like the rest of the app's, so it is rendered
// inside the same provider the app gives it, with the english the app ships
const render = logs => {
  const store = createStore()

  store.set(logsAtom, Object.assign({
    dir: '/app/storage/logs',
    files: [],
    file: 'laravel.log',
    entries: [],
    size: 384 * 1024,
    read: 128 * 1024,
    from: 256 * 1024,
    loading: false,
    error: '',
  }, logs))

  return renderToStaticMarkup(
    <IntlProvider locale='en' messages={Object.assign({}, added, flatten(english))}>
      <Provider store={store}>
        <LogsPanel/>
      </Provider>
    </IntlProvider>,
  )
}

// the one button with that word on it
const button = (markup, label) => markup.match(new RegExp(`<button[^>]*>${label}</button>`))[0]

describe('the log viewer', () => {
  test('says it read the end of the file when that is where the window is', () => {
    const markup = render({})

    expect(markup).toContain('read the last 128 KB of 384 KB')
    expect(button(markup, 'Older')).not.toContain('disabled')
    // nothing newer than the end of the file
    expect(button(markup, 'Newer')).toContain('disabled')
  })

  test('says how far before the end a window away from it ends', () => {
    const markup = render({from: 128 * 1024})

    expect(markup).toContain('read 128 KB ending 128 KB before the end of 384 KB')
    expect(button(markup, 'Older')).not.toContain('disabled')
    expect(button(markup, 'Newer')).not.toContain('disabled')
  })

  test('has nothing older to offer at the start of the file', () => {
    const markup = render({from: 0})

    expect(button(markup, 'Older')).toContain('disabled')
    expect(button(markup, 'Newer')).not.toContain('disabled')
  })

  test('has nothing to step through until a file is open', () => {
    const markup = render({file: '', from: 0, size: 0, read: 0})

    expect(button(markup, 'Older')).toContain('disabled')
    expect(button(markup, 'Newer')).toContain('disabled')
  })
})
