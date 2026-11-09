import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {FormProvider, useForm} from 'react-hook-form'
import {createStore, Provider} from 'jotai'
import flatten from 'flat'

import ConnectionRoute from '../ConnectionRoute'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

const render = values => {
  const host = document.createElement('div')

  document.body.appendChild(host)

  const Harness = () => {
    const form = useForm({defaultValues: values})

    return <FormProvider {...form}><ConnectionRoute/></FormProvider>
  }

  ReactDOM.render(
    <Provider store={createStore()}>
      <IntlProvider locale='en' messages={flatten(english)}>
        <Harness/>
      </IntlProvider>
    </Provider>,
    host,
  )

  return {
    stops: () => [...host.querySelectorAll('.route__stop')].map(one => one.textContent),
    done: () => {
      ReactDOM.unmountComponentAtNode(host)
      host.remove()
    },
  }
}

describe('the route of a connection', () => {
  // kubectl has no working-directory flag, so the directory it prints is the one
  // the session cd's into inside the pod — and a pod's filesystem is its image's,
  // so the machine's path is not a directory it has
  test('shows the directory a pod is cd\'d into, and not the machine\'s', () => {
    const view = render({
      container_engine: 'kubectl',
      container_name: 'api-7f9',
      container_path: '/var/www/html',
      path: '/home/me/app',
      container_command: 'php artisan tinker',
    })

    expect(view.stops()).toEqual(['kubectl api-7f9', '/var/www/html', 'php artisan tinker'])

    view.done()
  })

  // a pod that names no directory runs where its image starts, which is what
  // kubectl does on its own: there is no stop to print for it
  test('shows no directory for a pod that names none', () => {
    const view = render({
      container_engine: 'kubectl',
      container_name: 'api-7f9',
      path: '/home/me/app',
      container_command: 'php artisan tinker',
    })

    expect(view.stops()).toEqual(['kubectl api-7f9', 'php artisan tinker'])

    view.done()
  })

  // the engines with a flag for it are told the directory, and one still to be
  // filled in reads as the field it comes from
  test('shows the directory of an engine that runs with one', () => {
    const view = render({
      container_engine: 'docker',
      container_name: 'app',
      container_path: '/var/www/html',
      path: '/home/me/app',
      container_command: 'php artisan tinker',
    })

    expect(view.stops()).toEqual(['docker app', '/var/www/html', 'php artisan tinker'])

    view.done()

    const missing = render({container_engine: 'docker', container_name: 'app', container_path: ''})

    expect(missing.stops()).toContain(flatten(english)['connections.path'])

    missing.done()
  })
})
