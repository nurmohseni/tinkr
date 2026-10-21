import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'

import CloudForm from '../CloudForm'
import english from '../../../../../tinkr-main/src/lang/en.json'
import {cloudStatus, forgetCloudToken, openExternal, setCloudToken} from '../../../utils/api'

jest.mock('../../../utils/api', () => ({
  cloudStatus: jest.fn(),
  setCloudToken: jest.fn(),
  forgetCloudToken: jest.fn(),
  openExternal: jest.fn(),
}))

global.React = React

const render = answers => {
  cloudStatus.mockImplementation(answers.cloudStatus)

  const host = document.createElement('div')
  document.body.appendChild(host)

  ReactDOM.render(
    <IntlProvider locale='en' messages={flatten(english)}>
      <CloudForm/>
    </IntlProvider>,
    host,
  )

  const field = () => host.querySelector('input[type=password]')
  const press = label => [...host.querySelectorAll('button')].find(one => one.textContent === label).click()

  return {
    host,
    field,
    type: value => {
      const input = field()

      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new window.Event('input', {bubbles: true}))
    },
    buttons: () => [...host.querySelectorAll('button')].map(one => one.textContent),
    press,
    text: () => host.textContent,
    done: () => { ReactDOM.unmountComponentAtNode(host); host.remove() },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(async () => {
  await settle()
  cloudStatus.mockReset()
  setCloudToken.mockReset()
  forgetCloudToken.mockReset()
  openExternal.mockReset()
})

describe('the Laravel Cloud token', () => {
  test('takes a token, checks it, and says it is kept', async () => {
    setCloudToken.mockResolvedValue({ok: true, applications: 3})

    const view = render({cloudStatus: async () => ({hasToken: false})})

    await settle()

    // the field is there once the main process has said there is no token, and
    // not before: a field that appears and disappears under a hand is worse than
    // a moment of nothing
    expect(view.host.querySelector('input[type=password]')).not.toBeNull()

    view.type('token-123')
    view.press('Check and save')

    await settle()

    expect(setCloudToken).toHaveBeenCalledWith('token-123')
    expect(view.text()).toContain('Token saved. It reached 3 applications.')

    // what the main process keeps is the token, and the field is not handed it
    // back: what is on screen from here is only that one is saved
    expect(view.field()).toBeNull()
    expect(view.buttons()).toEqual(expect.arrayContaining(['Replace', 'Forget']))

    view.done()
  })

  test('says why a token was refused, and keeps the field for another try', async () => {
    setCloudToken.mockResolvedValue({
      ok: false,
      error: {code: 'unauthorized', message: 'This token is not valid.'},
    })

    const view = render({cloudStatus: async () => ({hasToken: false})})

    await settle()

    view.type('wrong')
    view.press('Check and save')

    await settle()

    expect(view.text()).toContain('This token is not valid.')
    expect(view.field()).not.toBeNull()

    view.done()
  })

  test('forgets a token, and asks for one again', async () => {
    const view = render({cloudStatus: async () => ({hasToken: true})})

    await settle()

    expect(view.field()).toBeNull()

    view.press('Forget')

    await settle()

    expect(forgetCloudToken).toHaveBeenCalled()
    expect(view.field()).not.toBeNull()

    view.done()
  })

  // a token made without the permissions the API needs answers 403 later, so the
  // list is part of the section rather than something to go and look up
  test('lists the permissions a token needs, and opens Laravel Cloud', async () => {
    const view = render({cloudStatus: async () => ({hasToken: false})})

    await settle()

    expect(view.text()).toContain('Applications: View applications')
    expect(view.text()).toContain('Environments: View environments, View environment instances, Create environment commands, View environment logs')

    view.press('Open Laravel Cloud')

    expect(openExternal).toHaveBeenCalledWith('https://cloud.laravel.com')

    view.done()
  })
})
