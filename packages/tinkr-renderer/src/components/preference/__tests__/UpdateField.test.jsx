import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'

import UpdateField from '../UpdateField'
import english from '../../../../../tinkr-main/src/lang/en.json'
import {checkForUpdates} from '../../../utils/api'

jest.mock('../../../utils/api', () => ({checkForUpdates: jest.fn()}))

// the version the window prints is inlined by the build, and a test has no build
jest.mock('../../../utils/appVersion', () => '0.4.4')

global.React = React

const render = () => {
  const host = document.createElement('div')
  document.body.appendChild(host)

  ReactDOM.render(
    <IntlProvider locale='en' messages={flatten(english)}>
      <UpdateField/>
    </IntlProvider>,
    host,
  )

  return {
    host,
    button: () => host.querySelector('button'),
    press: () => host.querySelector('button').click(),
    text: () => host.textContent,
    done: () => { ReactDOM.unmountComponentAtNode(host); host.remove() },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(async () => {
  await settle()
  checkForUpdates.mockReset()
})

describe('the check for updates', () => {
  test('asks on a press and says the running version is the newest one', async () => {
    checkForUpdates.mockResolvedValue({status: 'newest'})

    const view = render()

    expect(view.text()).toContain('check whether a newer version of Tinkr has been released')

    view.press()

    await settle()

    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(view.text()).toContain('Tinkr 0.4.4 is the newest version there is.')
    expect(view.button().textContent).toBe('Check for updates')
    expect(view.button().disabled).toBe(false)

    view.done()
  })

  test('says which version is out, and leaves the download to the app', async () => {
    checkForUpdates.mockResolvedValue({status: 'available', latest: '0.4.5'})

    const view = render()

    view.press()

    await settle()

    expect(view.text()).toContain('Tinkr 0.4.5 is out. The app window asks whether to download it.')

    // nothing is downloaded from here: the prompt in the app window is the
    // only place that asks, and it asks once
    expect(view.button().textContent).toBe('Check for updates')

    view.done()
  })

  test('says a build that cannot update itself cannot, instead of doing nothing', async () => {
    checkForUpdates.mockResolvedValue({status: 'unavailable'})

    const view = render()

    view.press()

    await settle()

    expect(view.text()).toContain('Tinkr 0.4.4 cannot update itself: it was not installed from a release.')

    view.done()
  })

  test('says why the releases could not be read', async () => {
    checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))

    const view = render()

    view.press()

    await settle()

    expect(view.text()).toContain('The check could not be made: net::ERR_INTERNET_DISCONNECTED')

    view.done()
  })

  test('says it is checking while the releases are being asked', async () => {
    let answer

    checkForUpdates.mockImplementation(() => new Promise(resolve => { answer = resolve }))

    const view = render()

    view.press()

    await settle()

    expect(view.button().textContent).toBe('Checking…')
    expect(view.button().disabled).toBe(true)

    answer({status: 'newest'})

    await settle()

    expect(view.button().textContent).toBe('Check for updates')
    expect(view.button().disabled).toBe(false)

    view.done()
  })
})
