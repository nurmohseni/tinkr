import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {FormProvider, useForm} from 'react-hook-form'
import flatten from 'flat'

import CloudForm from '../CloudForm'
import english from '../../../../../tinkr-main/src/lang/en.json'
import {cloudStatus, listCloudApplications} from '../../../utils/api'

// api.js binds the bridge at import time, so replacing window.api here would be
// too late: what the section calls is these names, and this is where to say what
// they answer
jest.mock('../../../utils/api', () => ({
  cloudStatus: jest.fn(),
  listCloudApplications: jest.fn(),
  openPreference: jest.fn(),
}))

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

const applications = [{
  id: 'app-1',
  name: 'acme',
  slug: 'acme',
  region: 'eu-west-1',
  environments: [
    {id: 'env-1', name: 'main', slug: 'main', status: 'running', phpVersion: '8.3', domain: ''},
    {id: 'env-2', name: 'staging', slug: 'staging', status: 'hibernating', phpVersion: '8.2', domain: ''},
  ],
}]

const render = (values, answers) => {
  cloudStatus.mockImplementation(answers.cloudStatus)
  listCloudApplications.mockImplementation(answers.listCloudApplications)

  const host = document.createElement('div')
  document.body.appendChild(host)

  let form = null

  const Harness = () => {
    form = useForm({defaultValues: values})

    return <FormProvider {...form}><CloudForm/></FormProvider>
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
    notes: () => [...host.querySelectorAll('.cfield__note')].map(one => one.textContent),
    choose: (id, value) => {
      const select = host.querySelector(`#${id}`)
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set

      setter.call(select, value)
      select.dispatchEvent(new window.Event('change', {bubbles: true}))
    },
    press: label => [...host.querySelectorAll('button')].find(one => one.textContent === label).click(),
    values: () => form.getValues(),
    done: () => { ReactDOM.unmountComponentAtNode(host); host.remove() },
  }
}

// the reads are promises; the render has to wait the same way the section does
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(async () => {
  await settle()
  cloudStatus.mockReset()
  listCloudApplications.mockReset()
})

describe('the Laravel Cloud fields of a connection', () => {
  test('is not drawn for a connection that runs anywhere else', async () => {
    const view = render({is_cloud: false}, {cloudStatus: jest.fn(), listCloudApplications: jest.fn()})

    await settle()

    expect(view.host.querySelector('#connection-cloud-application')).toBeNull()
    expect(cloudStatus).not.toHaveBeenCalled()

    view.done()
  })

  test('sends the person to the settings when there is no token', async () => {
    const openPreference = jest.requireMock('../../../utils/api').openPreference
    const view = render({is_cloud: true}, {
      cloudStatus: async () => ({hasToken: false}),
      listCloudApplications: jest.fn(),
    })

    await settle()

    expect(view.notes()).toEqual(['No Laravel Cloud token yet. Add one in the settings, then come back here.'])
    expect(listCloudApplications).not.toHaveBeenCalled()

    view.press('Open the Laravel Cloud settings')
    expect(openPreference).toHaveBeenCalledWith('cloud')

    view.done()
  })

  // the environment's state and php are what the choice is worth knowing before
  // it is made, and a hibernating one is still a valid choice: the API boots it
  test('lists the environments with their state and their php', async () => {
    const view = render({is_cloud: true, cloud_application_id: 'app-1'}, {
      cloudStatus: async () => ({hasToken: true}),
      listCloudApplications: async () => ({ok: true, applications}),
    })

    await settle()

    expect(view.options('connection-cloud-application')).toEqual([
      ['', 'Choose an application'],
      ['app-1', 'acme'],
    ])

    expect(view.options('connection-cloud-environment')).toEqual([
      ['', 'Choose an environment'],
      ['env-1', 'main · running · PHP 8.3'],
      ['env-2', 'staging · hibernating · PHP 8.2'],
    ])

    view.done()
  })

  test('a chosen application and environment are what the form saves', async () => {
    const view = render({is_cloud: true, name: 'New Connection'}, {
      cloudStatus: async () => ({hasToken: true}),
      listCloudApplications: async () => ({ok: true, applications}),
    })

    await settle()

    view.choose('connection-cloud-application', 'app-1')

    await settle()

    view.choose('connection-cloud-environment', 'env-2')

    const values = view.values()

    expect(values.cloud_application_id).toBe('app-1')
    expect(values.cloud_application_name).toBe('acme')
    expect(values.cloud_environment_id).toBe('env-2')
    expect(values.cloud_environment_name).toBe('staging')
    // the dialog opens on the default name, which is a label rather than a
    // choice: the environment's route is what names the connection
    expect(values.name).toBe('acme · staging')

    view.done()
  })

  // a saved environment that the account no longer lists is shown as missing
  // rather than cleared: the connection is not edited behind the person's back
  test('a saved environment the application no longer has is shown, not cleared', async () => {
    const view = render({
      is_cloud: true,
      cloud_application_id: 'app-1',
      cloud_application_name: 'acme',
      cloud_environment_id: 'env-gone',
      cloud_environment_name: 'feature-x',
    }, {
      cloudStatus: async () => ({hasToken: true}),
      listCloudApplications: async () => ({ok: true, applications}),
    })

    await settle()

    expect(view.options('connection-cloud-environment')).toEqual([
      ['', 'Choose an environment'],
      ['env-gone', 'feature-x (missing)'],
      ['env-1', 'main · running · PHP 8.3'],
      ['env-2', 'staging · hibernating · PHP 8.2'],
    ])

    expect(view.notes()).toContain('feature-x is not in this application any more. Choose another environment.')
    expect(view.values().cloud_environment_id).toBe('env-gone')

    view.done()
  })

  test('a read that failed says so, and asks again when it is told to', async () => {
    const listCloudApplications = jest.fn()
      .mockResolvedValueOnce({ok: false, error: {code: 'unauthorized', message: 'This token is not valid.'}})
      .mockResolvedValueOnce({ok: true, applications})

    const view = render({is_cloud: true}, {
      cloudStatus: async () => ({hasToken: true}),
      listCloudApplications,
    })

    await settle()

    expect(view.notes()).toEqual(['This token is not valid.'])

    view.press('Try again')

    await settle()

    expect(view.options('connection-cloud-application')).toEqual([
      ['', 'Choose an application'],
      ['app-1', 'acme'],
    ])

    view.done()
  })
})
