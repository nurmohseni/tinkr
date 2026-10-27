import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {IntlProvider} from 'react-intl'
import {Provider, createStore} from 'jotai'
import flatten from 'flat'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

global.IS_REACT_ACT_ENVIRONMENT = true
const logRead = jest.fn(() => Promise.resolve({size: 10, read: 10, from: 0, entries: []}))

window.api = {logRead}

const english = require('../../../../../tinkr-main/src/lang/en.json')
const {logsAtom, logsLevelsAtom} = require('../../../stores/logs')
const LogsFilter = require('../LogsFilter').default
const {asField, asStamp, levels} = require('../LogsFilter')

const messages = flatten(english)

const render = (store = createStore(), onClose = jest.fn()) => {
  // the panel is only ever raised over an open file, so the store has one
  if (!store.get(logsAtom).file) {
    store.set(logsAtom, {file: 'laravel.log', entries: []})
  }

  const host = document.createElement('div')
  const root = createRoot(host)

  document.body.appendChild(host)

  act(() => {
    root.render(
      <IntlProvider locale='en' messages={messages}>
        <Provider store={store}>
          <LogsFilter onClose={onClose}/>
        </Provider>
      </IntlProvider>,
    )
  })

  return {host, root, store, onClose}
}

const boxes = host => [...host.querySelectorAll('input[type="checkbox"]')]
const dates = host => [...host.querySelectorAll('input[type="datetime-local"]')]
const setValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set

  setter.call(input, value)
  input.dispatchEvent(new window.Event('input', {bubbles: true}))
}

afterEach(() => {
  document.body.innerHTML = ''
  logRead.mockClear()
})

describe('the moment fields', () => {
  test('read a log stamp into a datetime field, and back', () => {
    expect(asField('2026-08-27 11:10:52')).toBe('2026-08-27T11:10:52')
    expect(asStamp('2026-08-27T11:10:52')).toBe('2026-08-27 11:10:52')
  })

  test('give a minute given without seconds its own second, so it means what it says', () => {
    expect(asStamp('2026-08-27T11:10')).toBe('2026-08-27 11:10:00')
  })

  test('are empty when nothing was asked for, which is open-ended', () => {
    expect(asField('')).toBe('')
    expect(asStamp('')).toBe('')
  })
})

describe('the filter over a log', () => {

  test('leaves a level out of what is shown when its box is cleared', () => {
    const {host, store} = render()
    const notice = boxes(host)[levels.indexOf('notice')]

    act(() => {
      notice.click()
    })

    // the set is what is left out, so clearing one box names just that one
    expect(store.get(logsLevelsAtom)).toEqual(['notice'])
    expect(boxes(host)[levels.indexOf('notice')].checked).toBe(false)
  })

  test('leaves only the levels whose boxes are cleared out of what is shown', () => {
    const {host, store} = render()

    // clearing every box but one is asking for that one alone
    for (const level of levels) {
      if (level !== 'error') {
        act(() => {
          boxes(host)[levels.indexOf(level)].click()
        })
      }
    }

    expect(store.get(logsLevelsAtom)).not.toContain('error')
    expect(store.get(logsLevelsAtom).length).toBe(levels.length - 1)
    expect(boxes(host)[levels.indexOf('error')].checked).toBe(true)
  })

  test('has no filter left once the level that was left out is put back', () => {
    const {host, store} = render()
    const notice = () => boxes(host)[levels.indexOf('notice')]

    act(() => {
      notice().click()
    })

    expect(store.get(logsLevelsAtom)).toEqual(['notice'])

    act(() => {
      notice().click()
    })

    // nothing left out is no filter, which is what an empty set says
    expect(store.get(logsLevelsAtom)).toEqual([])
    expect(notice().checked).toBe(true)
  })

  test('shows nothing when every level is left out, rather than quietly showing them all', () => {
    const {host, store} = render()

    for (const box of boxes(host)) {
      act(() => {
        box.click()
      })
    }

    // a filter that excludes everything is a real answer, and is not the same as
    // no filter: the panel must not fall back to showing all of them
    expect(store.get(logsLevelsAtom).length).toBe(levels.length)
  })


  test('never narrows a field past its other end', () => {
    const {host} = render()
    const [from, to] = dates(host)

    expect(to.getAttribute('min')).toBe(null)
    expect(from.getAttribute('max')).toBe(null)

    act(() => {
      setValue(from, '2026-08-27T06:00:00')
    })

    // the field keeps the moment it was given, to the second
    expect(to.getAttribute('min')).toMatch(/^2026-08-27T06:00/)
  })
})
