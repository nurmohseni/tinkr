import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'

import VaporForm from '../VaporForm'
import english from '../../../../../tinkr-main/src/lang/en.json'
import {
  forgetVaporToken, importVaporCliToken, setVaporToken, vaporStatus,
} from '../../../utils/api'

jest.mock('../../../utils/api', () => ({
  vaporStatus: jest.fn(),
  setVaporToken: jest.fn(),
  forgetVaporToken: jest.fn(),
  importVaporCliToken: jest.fn(),
}))

global.React = React

const render = answers => {
  vaporStatus.mockImplementation(answers.vaporStatus)

  const host = document.createElement('div')
  document.body.appendChild(host)

  ReactDOM.render(
    <IntlProvider locale='en' messages={flatten(english)}>
      <VaporForm/>
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
  vaporStatus.mockReset()
  setVaporToken.mockReset()
  forgetVaporToken.mockReset()
  importVaporCliToken.mockReset()
})

describe('the Laravel Vapor token', () => {
  test('takes a token, checks it, and says it is kept', async () => {
    setVaporToken.mockResolvedValue({ok: true, teams: 2})

    const view = render({vaporStatus: async () => ({hasToken: false, cliLogin: false})})

    await settle()

    // the field is there once the main process has said there is no token, and
    // not before: a field that appears and disappears under a hand is worse than
    // a moment of nothing
    expect(view.host.querySelector('input[type=password]')).not.toBeNull()

    view.type('token-123')
    view.press('Check and save')

    await settle()

    expect(setVaporToken).toHaveBeenCalledWith('token-123')
    expect(view.text()).toContain('Token saved. It reached 2 teams.')

    // what the main process keeps is the token, and the field is not handed it
    // back: what is on screen from here is only that one is saved
    expect(view.field()).toBeNull()
    expect(view.buttons()).toEqual(expect.arrayContaining(['Replace', 'Forget']))

    view.done()
  })

  // the description is where the token comes from, because the API tokens are
  // one page of an account's settings that nobody should have to hunt for
  test('says where a token is made', async () => {
    const view = render({vaporStatus: async () => ({hasToken: false, cliLogin: false})})

    await settle()

    expect(view.text()).toContain("Create one in Laravel Vapor under your account's API tokens.")

    view.done()
  })

  test('says why a token was refused, and keeps the field for another try', async () => {
    setVaporToken.mockResolvedValue({
      ok: false,
      error: {code: 'unauthorized', message: 'This token is not valid.'},
    })

    const view = render({vaporStatus: async () => ({hasToken: false, cliLogin: false})})

    await settle()

    view.type('wrong')
    view.press('Check and save')

    await settle()

    expect(view.text()).toContain('This token is not valid.')
    expect(view.field()).not.toBeNull()

    view.done()
  })

  test('forgets a token, and asks for one again', async () => {
    const view = render({vaporStatus: async () => ({hasToken: true, cliLogin: false})})

    await settle()

    expect(view.field()).toBeNull()

    view.press('Forget')

    await settle()

    expect(forgetVaporToken).toHaveBeenCalled()
    expect(view.field()).not.toBeNull()

    view.done()
  })

  // someone who has used the CLI has no reason to make a second token: the login
  // on the machine is offered, and the team it is set to comes back with it
  test('takes the Vapor CLI login when the machine has one', async () => {
    importVaporCliToken.mockResolvedValue({ok: true, teams: 1, team: 'Acme'})

    const view = render({vaporStatus: async () => ({hasToken: false, cliLogin: true})})

    await settle()

    view.press('Use the Vapor CLI login on this machine')

    await settle()

    expect(importVaporCliToken).toHaveBeenCalled()
    expect(view.text()).toContain('Token imported from the Vapor CLI. It reached 1 team, and the CLI is set to the team Acme.')
    expect(view.field()).toBeNull()

    view.done()
  })

  test('is not offered the CLI login when the machine has none', async () => {
    const view = render({vaporStatus: async () => ({hasToken: false, cliLogin: false})})

    await settle()

    expect(view.buttons()).not.toContain('Use the Vapor CLI login on this machine')

    view.done()
  })
})
