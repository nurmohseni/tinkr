import React from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import {Provider, createStore} from 'jotai'
import flatten from 'flat'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

// the panel is drawn from the store the window has open, and reads nothing else
// itself, but the store's module takes the bridge's calls as it loads: the read
// is the one call following is about, so it is the one that answers
const logRead = jest.fn(() => Promise.resolve({size: 10, read: 10, from: 0, entries: []}))

window.api = {logRead}

const english = require('../../../../../tinkr-main/src/lang/en.json')
const {logsAtom, logsFollowAtom} = require('../../../stores/logs')
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

describe('following a log', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    logRead.mockClear()
  })

  afterEach(() => jest.useRealTimers())

  test('reads the file again on its own while the switch is on', () => {
    const store = createStore()
    const host = document.createElement('div')

    store.set(logsAtom, {
      dir: '/app/storage/logs', files: [], file: 'laravel.log', entries: [],
      size: 10, read: 10, from: 0, loading: false, error: '',
    })
    store.set(logsFollowAtom, true)

    const root = createRoot(host)

    act(() => {
      root.render(
        <IntlProvider locale='en' messages={Object.assign({}, added, flatten(english))}>
          <Provider store={store}>
            <LogsPanel/>
          </Provider>
        </IntlProvider>,
      )
    })

    expect(logRead).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(4100)
    })

    // the default is every two seconds: twice in a little over four
    expect(logRead).toHaveBeenCalledTimes(2)
    expect(logRead).toHaveBeenCalledWith('laravel.log', undefined)

    // and turning it off stops it
    act(() => {
      store.set(logsFollowAtom, false)
    })
    act(() => {
      jest.advanceTimersByTime(6000)
    })

    expect(logRead).toHaveBeenCalledTimes(2)

    act(() => root.unmount())
  })
})
