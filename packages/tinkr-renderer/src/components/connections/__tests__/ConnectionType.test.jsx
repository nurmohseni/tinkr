import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {FormProvider, useForm} from 'react-hook-form'
import flatten from 'flat'

import ConnectionType from '../ConnectionType'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

const render = values => {
  const host = document.createElement('div')

  document.body.appendChild(host)

  let form = null

  const Harness = () => {
    form = useForm({defaultValues: values})

    return <FormProvider {...form}><ConnectionType/></FormProvider>
  }

  ReactDOM.render(
    <IntlProvider locale='en' messages={flatten(english)}>
      <Harness/>
    </IntlProvider>,
    host,
  )

  const radios = () => [...host.querySelectorAll('input[name=connection-type]')]

  return {
    kinds: radios().map(one => one.value),
    checked: () => radios().find(one => one.checked).value,
    choose: kind => radios().find(one => one.value === kind).click(),
    values: () => form.getValues(),
    done: () => { ReactDOM.unmountComponentAtNode(host); host.remove() },
  }
}

describe('the type of a connection', () => {
  // the two answers are not exclusive any more: a project deployed by a compose
  // file on a server is a container on that server, and the rail has to say so
  test('offers the five, including a container on a server and Laravel Cloud', () => {
    const view = render({is_over_ssh: false})

    expect(view.kinds).toEqual(['local', 'container', 'ssh', 'ssh-container', 'cloud'])
    expect(view.checked()).toBe('local')

    view.done()
  })

  test('opens on the state a saved connection already has', () => {
    const both = render({is_over_ssh: true, container_engine: 'podman'})
    expect(both.checked()).toBe('ssh-container')
    both.done()

    const ssh = render({is_over_ssh: true})
    expect(ssh.checked()).toBe('ssh')
    ssh.done()

    const container = render({is_over_ssh: false, container_engine: 'docker'})
    expect(container.checked()).toBe('container')
    container.done()

    // a cloud connection is read from its own field, and it outranks the two
    // that describe a machine: it has neither
    const cloud = render({is_cloud: true})
    expect(cloud.checked()).toBe('cloud')
    cloud.done()
  })

  // a kind sets both fields, and clears what it no longer owns: leaving the
  // container kinds behind drops the engine, and coming back starts at the
  // default rather than at something nobody chose
  test('picks both answers, and clears the one it no longer holds', () => {
    const view = render({is_over_ssh: true, container_engine: 'podman'})

    view.choose('local')
    expect(view.values().is_over_ssh).toBe(false)
    expect(view.values().container_engine).toBe('')

    view.choose('ssh-container')
    expect(view.values().is_over_ssh).toBe(true)
    expect(view.values().container_engine).toBe('docker')

    view.choose('ssh')
    expect(view.values().is_over_ssh).toBe(true)
    expect(view.values().container_engine).toBe('')

    view.done()
  })

  // a cloud connection reaches no machine and no container, so choosing it is
  // the one choice that clears both of the answers the other kinds set
  test('choosing Laravel Cloud clears the ssh and container fields', () => {
    const view = render({
      is_over_ssh: true,
      container_engine: 'podman',
      container_path: '/var/www/html',
      container_name: 'app',
    })

    view.choose('cloud')

    expect(view.values().is_cloud).toBe(true)
    expect(view.values().is_over_ssh).toBe(false)
    expect(view.values().container_engine).toBe('')
    expect(view.values().container_path).toBe('')

    view.done()
  })

  test('choosing any other kind stops being a cloud connection', () => {
    const view = render({is_cloud: true, cloud_environment_id: 'env-1'})

    view.choose('local')

    expect(view.values().is_cloud).toBe(false)
    view.done()
  })
})
