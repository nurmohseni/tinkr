import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {FormProvider, useForm} from 'react-hook-form'
import flatten from 'flat'

import ContainerForm from '../ContainerForm'
import english from '../../../../../tinkr-main/src/lang/en.json'
import {listContainers, listProjectDirs} from '../../../utils/api'

// api.js binds the bridge at import time, so replacing window.api here would be
// too late: what the component calls is these two names, and this is where to
// say what they answer
jest.mock('../../../utils/api', () => ({
  listContainers: jest.fn(),
  listProjectDirs: jest.fn(),
}))

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

const render = (values, api) => {
  listContainers.mockImplementation(api.listContainers)
  listProjectDirs.mockImplementation(api.listProjectDirs)

  const host = document.createElement('div')
  document.body.appendChild(host)

  const Harness = () => {
    const form = useForm({defaultValues: values})
    return <FormProvider {...form}><ContainerForm/></FormProvider>
  }

  ReactDOM.render(
    <IntlProvider locale='en' messages={flatten(english)}>
      <Harness/>
    </IntlProvider>,
    host,
  )

  return {
    host,
    options: id => [...host.querySelectorAll(`#${id} option`)].map(one => [one.value, one.textContent]),
    done: () => { ReactDOM.unmountComponentAtNode(host); host.remove() },
  }
}

// the reads are promises; the render has to wait the same way the form does
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

// a rendered form keeps its promises running after the markup is gone, and one
// from the test before is not a call this test made
beforeEach(async () => {
  await settle()
  listContainers.mockClear()
  listProjectDirs.mockClear()
})

describe('the container fields of a connection', () => {
  // the name is not something to type: a compose file or a PaaS names one per
  // deploy, so what is offered is what is running now
  test('offers the containers the engine reports, and the projects inside one', async () => {
    const view = render(
      {is_over_ssh: true, ssh_server: 'srv', ssh_user: 'deploy', container_engine: 'docker', container_name: 'app-abc123', container_path: ''},
      {
        listContainers: jest.fn(async () => [{name: 'app-abc123', image: 'my/app:latest'}, {name: 'db-1', image: 'postgres:16'}]),
        listProjectDirs: jest.fn(async () => ['/var/www/html', '/srv/app']),
      },
    )

    await settle()

    expect(listContainers).toHaveBeenCalledWith(expect.objectContaining({container_engine: 'docker', ssh_server: 'srv'}))
    expect(view.options('connection-container-names')).toEqual([
      ['app-abc123', 'my/app:latest'],
      ['db-1', 'postgres:16'],
    ])

    expect(listProjectDirs).toHaveBeenCalledWith(expect.objectContaining({container_name: 'app-abc123'}))
    expect(view.options('connection-container-paths')).toEqual([
      ['/var/www/html', ''],
      ['/srv/app', ''],
    ])

    view.done()
  })

  // a server that only lets a key in refuses a listing made without it, and
  // the form would read the refusal as "nothing is running"
  test('reaches the server with the connection\'s own key', async () => {
    const view = render(
      {is_over_ssh: true, ssh_server: 'srv', ssh_user: 'root', ssh_key: '/home/me/.ssh/id_deploy', container_engine: 'docker', container_name: 'app-1', container_path: ''},
      {listContainers: jest.fn(async () => []), listProjectDirs: jest.fn(async () => [])},
    )

    await settle()

    expect(listContainers).toHaveBeenCalledWith(expect.objectContaining({ssh_key: '/home/me/.ssh/id_deploy'}))
    expect(listProjectDirs).toHaveBeenCalledWith(expect.objectContaining({ssh_key: '/home/me/.ssh/id_deploy'}))

    view.done()
  })

  // a machine that cannot answer is one with nothing to offer, and the field is
  // still a field: a typed name is what a connection the app cannot list uses
  test('never blocks the field, and says so when nothing answered', async () => {
    const view = render(
      {is_over_ssh: true, ssh_server: 'srv', ssh_user: 'deploy', container_engine: 'docker', container_name: ''},
      {
        listContainers: jest.fn(async () => []),
        listProjectDirs: jest.fn(async () => []),
      },
    )

    await settle()

    const name = view.host.querySelector('input[name=container_name]')

    expect(name.tagName).toBe('INPUT')
    expect(name.getAttribute('list')).toBe('connection-container-names')
    expect(view.host.textContent).toContain('No running container answered')

    view.done()
  })

  // a container is listed once the machine it runs on is known, so a form with
  // no server does not ask a question that cannot be answered
  test('asks nothing until there is a machine to ask', async () => {
    const view = render(
      {is_over_ssh: true, ssh_server: '', ssh_user: '', container_engine: 'docker'},
      {listContainers: jest.fn(async () => []), listProjectDirs: jest.fn(async () => [])},
    )

    await settle()

    expect(listContainers).not.toHaveBeenCalled()
    expect(listProjectDirs).not.toHaveBeenCalled()

    view.done()
  })
})
