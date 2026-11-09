import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {FormProvider, useForm} from 'react-hook-form'
import flatten from 'flat'

import ContainerForm from '../ContainerForm'
import english from '../../../../../tinkr-main/src/lang/en.json'
import {listContainers, listProjectDirs, listKubeContexts, listKubeNamespaces} from '../../../utils/api'

// api.js binds the bridge at import time, so replacing window.api here would be
// too late: what the component calls is these two names, and this is where to
// say what they answer
jest.mock('../../../utils/api', () => ({
  listContainers: jest.fn(),
  listProjectDirs: jest.fn(),
  listKubeContexts: jest.fn(),
  listKubeNamespaces: jest.fn(),
}))

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

const render = (values, api) => {
  listContainers.mockImplementation(api.listContainers)
  listProjectDirs.mockImplementation(api.listProjectDirs)
  // a test that says nothing about the pod's two lists is a test of another
  // engine, and a question nobody asked is a question with no answer
  listKubeContexts.mockImplementation(api.listKubeContexts || (async () => []))
  listKubeNamespaces.mockImplementation(api.listKubeNamespaces || (async () => []))

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
    // what a person typing into a field does: the form's values change, and the
    // question built from them is asked again
    type: (id, value) => {
      const input = host.querySelector(`#${id}`)
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set

      setter.call(input, value)
      input.dispatchEvent(new window.Event('input', {bubbles: true}))
    },
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
  listKubeContexts.mockClear()
  listKubeNamespaces.mockClear()
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

  // a pod is where its namespace and its context say it is, and the pods of
  // another namespace are another set of pods: the listing is asked again when
  // either changes, or the name offered is the one of a pod that is not there
  test('offers the contexts and namespaces of a pod, and lists its pods again', async () => {
    const view = render(
      {container_engine: 'kubectl', container_name: 'api-7f9', kube_namespace: '', kube_context: ''},
      {
        listContainers: jest.fn(async () => [{name: 'api-7f9', image: 'my/app:latest'}]),
        listProjectDirs: jest.fn(async () => []),
        listKubeContexts: jest.fn(async () => ['prod-eu', 'staging']),
        listKubeNamespaces: jest.fn(async () => ['production', 'staging']),
      },
    )

    await settle()

    expect(view.options('connection-kube-contexts')).toEqual([['prod-eu', ''], ['staging', '']])
    expect(view.options('connection-kube-namespaces')).toEqual([['production', ''], ['staging', '']])

    // what the form holds goes with every question, because the command is built
    // from it and the listing is of the pods it reaches
    expect(listContainers).toHaveBeenCalledWith(expect.objectContaining({
      container_engine: 'kubectl',
      kube_namespace: '',
      kube_context: '',
    }))

    listContainers.mockClear()
    view.type('connection-kube-namespace', 'production')
    await settle()

    expect(listContainers).toHaveBeenCalledWith(expect.objectContaining({kube_namespace: 'production'}))

    view.done()
  })

  // the four are kubectl's: no other engine is told a namespace or a context, and
  // a form that showed them for docker would ask for a value nothing uses
  test('shows the pod fields for a pod and for nothing else', async () => {
    const view = render(
      {container_engine: 'kubectl', container_name: 'api-7f9'},
      {listContainers: jest.fn(async () => []), listProjectDirs: jest.fn(async () => [])},
    )

    await settle()

    expect(['kube_namespace', 'kube_context', 'kube_config', 'kube_container']
      .map(one => Boolean(view.host.querySelector(`input[name=${one}]`))))
      .toEqual([true, true, true, true])

    view.done()
    // a form from the test before keeps its promises running after the markup is
    // gone, and none of them is a call this render made
    listKubeContexts.mockClear()
    listKubeNamespaces.mockClear()

    const docker = render(
      {container_engine: 'docker', container_name: 'app'},
      {listContainers: jest.fn(async () => []), listProjectDirs: jest.fn(async () => [])},
    )

    await settle()

    expect(['kube_namespace', 'kube_context', 'kube_config', 'kube_container']
      .map(one => Boolean(docker.host.querySelector(`input[name=${one}]`))))
      .toEqual([false, false, false, false])
    expect(listKubeContexts).not.toHaveBeenCalled()
    expect(listKubeNamespaces).not.toHaveBeenCalled()

    docker.done()
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
