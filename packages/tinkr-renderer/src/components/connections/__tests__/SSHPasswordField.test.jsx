import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {FormProvider, useForm} from 'react-hook-form'
import {createStore, Provider} from 'jotai'
import flatten from 'flat'

import SSHPasswordField from '../SSHPasswordField'
import {connectionDataAtom} from '../../../stores/connections'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

const render = (values, connections = {}) => {
  const store = createStore()

  store.set(connectionDataAtom, connections)

  const host = document.createElement('div')
  document.body.appendChild(host)

  const Harness = () => {
    const form = useForm({defaultValues: values})

    return <FormProvider {...form}><SSHPasswordField/></FormProvider>
  }

  ReactDOM.render(
    <Provider store={store}>
      <IntlProvider locale='en' messages={flatten(english)}>
        <Harness/>
      </IntlProvider>
    </Provider>,
    host,
  )

  const input = host.querySelector('input[name=password]')
  const markup = host.innerHTML

  return {
    input,
    markup,
    store,
    host,
    done: () => {
      ReactDOM.unmountComponentAtNode(host)
      host.remove()
    },
  }
}

describe('the password field of a connection', () => {
  // a password on screen is a password someone can read over a shoulder, in a
  // screenshot, or in a screen share, so the field never shows one — saved or not
  test('is a field with nothing in it, before and after one is saved', () => {
    const before = render({id: 'c1', password: '', ssh_password: false})

    expect(before.input.type).toBe('password')
    expect(before.input.value).toBe('')
    expect(before.input.placeholder).toBe("the server's password")
    expect(before.markup).not.toContain('Forget it')
    before.done()

    const after = render({id: 'c1', password: '', ssh_password: true})

    expect(after.input.type).toBe('password')
    expect(after.input.value).toBe('')
    expect(after.input.placeholder).toBe('saved')
    expect(after.markup).toContain('never shown again')
    after.done()
  })

  // a password that was saved is used by the session, and the only way to stop
  // using it is to say so: the field cannot be cleared into "no password"
  test('forgets a saved one when it is told to, in the main process and in the window', () => {
    const saved = render({id: 'c1', password: '', ssh_password: true}, {c1: {id: 'c1', ssh_password: true}})

    expect(saved.markup).toContain('Forget it')

    const forget = [...saved.host.querySelectorAll('button')].find(button => button.textContent.includes('Forget it'))

    // the main process is the one that removes the secret: the field asks it to,
    // and the window's own copy of the fact is cleared so the form says so
    window.api.forgetPassword.mockClear()
    forget.click()

    expect(window.api.forgetPassword).toHaveBeenCalledWith('c1')
    expect(saved.store.get(connectionDataAtom).c1.ssh_password).toBe(false)

    saved.done()
  })
})
