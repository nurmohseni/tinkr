import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {IntlProvider} from 'react-intl'
import {Provider, createStore} from 'jotai'
import flatten from 'flat'

global.React = React
global.IS_REACT_ACT_ENVIRONMENT = true

const logRead = jest.fn()
window.api = {logRead}

const english = require('../../../../../tinkr-main/src/lang/en.json')
const {emptyLogs, logsAtom, logsFollowAtom, readLogAtom} = require('../../../stores/logs')
const LogsPanel = require('../LogsPanel').default

const entry = message => ({at: '2026-10-20 10:00:00', level: 'info', message, details: ''})
const answer = (from, message) => ({
  file: 'laravel.log', size: from + 10, from, read: 10,
  range: {from: 0, to: from + 10}, entries: [entry(message)],
})

describe('log viewer loading and following', () => {
  let store
  let root
  let host

  beforeEach(() => {
    jest.useFakeTimers()
    logRead.mockReset()
    store = createStore()
    store.set(logsAtom, {...emptyLogs(), file: 'laravel.log'})
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    jest.useRealTimers()
  })

  const mount = () => act(() => root.render(
    <IntlProvider locale='en' messages={flatten(english)}>
      <Provider store={store}><LogsPanel/></Provider>
    </IntlProvider>,
  ))

  test('does not report no matches until a pending read has completed', async () => {
    let resolve
    logRead.mockImplementation(() => new Promise(done => { resolve = done }))
    let reading
    act(() => { reading = store.set(readLogAtom) })
    mount()

    expect(host.querySelector('.logs__body').getAttribute('aria-busy')).toBe('true')
    expect(host.querySelector('.logs__note')).toBeNull()

    await act(async () => {
      resolve({...answer(0, ''), read: 0, size: 0, range: {from: 0, to: 0}, entries: []})
      await reading
    })

    expect(host.querySelector('.logs__body').getAttribute('aria-busy')).toBe('false')
    expect(host.querySelector('.logs__note')).not.toBeNull()
  })

  test('does not automatically retry an errored short page', async () => {
    const page = answer(100, 'held entry')
    store.set(logsAtom, {...emptyLogs(), ...page, pages: [page], error: 'Permission denied'})
    mount()
    await act(async () => { jest.advanceTimersByTime(10_000) })

    expect(host.querySelector('.error').textContent).toBe('Permission denied')
    expect(logRead).not.toHaveBeenCalled()
  })

  test('polling adds new entries and stops adding them after follow is disabled', async () => {
    const initial = answer(0, 'initial entry')
    store.set(logsAtom, {...emptyLogs(), ...initial, pages: [initial]})
    store.set(logsFollowAtom, true)
    logRead.mockResolvedValue(answer(10, 'appended entry'))
    mount()

    await act(async () => { jest.advanceTimersByTime(2000) })
    expect([...host.querySelectorAll('.log__message')].map(one => one.textContent))
      .toEqual(['initial entry', 'appended entry'])

    act(() => store.set(logsFollowAtom, false))
    logRead.mockResolvedValue(answer(20, 'must not arrive'))
    await act(async () => { jest.advanceTimersByTime(6000) })
    expect([...host.querySelectorAll('.log__message')].map(one => one.textContent))
      .toEqual(['initial entry', 'appended entry'])
  })
})
