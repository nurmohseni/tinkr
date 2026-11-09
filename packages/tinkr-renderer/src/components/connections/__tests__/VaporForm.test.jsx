import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {FormProvider, useForm} from 'react-hook-form'
import flatten from 'flat'

import VaporForm from '../VaporForm'
import english from '../../../../../tinkr-main/src/lang/en.json'
import {listVaporProjects, vaporStatus} from '../../../utils/api'

// api.js binds the bridge at import time, so replacing window.api here would be
// too late: what the section calls is these names, and this is where to say what
// they answer
jest.mock('../../../utils/api', () => ({
  vaporStatus: jest.fn(),
  listVaporProjects: jest.fn(),
  openPreference: jest.fn(),
}))

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

const teams = [
  {
    id: 'team-1',
    name: 'Acme',
    projects: [
      {
        id: 'proj-1',
        name: 'shop',
        environments: [
          {id: 'env-1', name: 'main', domain: 'shop.example.com'},
          {id: 'env-2', name: 'staging', domain: 'staging-shop.example.com'},
        ],
      },
    ],
  },
  {
    id: 'team-2',
    name: 'Other',
    projects: [
      {
        id: 'proj-2',
        name: 'site',
        environments: [{id: 'env-3', name: 'production', domain: 'site.example.com'}],
      },
    ],
  },
]

const render = (values, answers) => {
  vaporStatus.mockImplementation(answers.vaporStatus)
  listVaporProjects.mockImplementation(answers.listVaporProjects)

  const host = document.createElement('div')
  document.body.appendChild(host)

  let form = null

  const Harness = () => {
    form = useForm({defaultValues: values})

    return <FormProvider {...form}><VaporForm/></FormProvider>
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

const saved = {hasToken: true, cliLogin: false}

beforeEach(async () => {
  await settle()
  vaporStatus.mockReset()
  listVaporProjects.mockReset()
  jest.requireMock('../../../utils/api').openPreference.mockReset()
})

describe('the Laravel Vapor fields of a connection', () => {
  test('is not drawn for a connection that runs anywhere else', async () => {
    const view = render({is_vapor: false}, {vaporStatus: jest.fn(), listVaporProjects: jest.fn()})

    await settle()

    expect(view.host.querySelector('#connection-vapor-team')).toBeNull()
    expect(vaporStatus).not.toHaveBeenCalled()

    view.done()
  })

  test('sends the person to the settings when there is no token', async () => {
    const openPreference = jest.requireMock('../../../utils/api').openPreference
    const view = render({is_vapor: true}, {
      vaporStatus: async () => ({hasToken: false, cliLogin: false}),
      listVaporProjects: jest.fn(),
    })

    await settle()

    expect(view.notes()).toEqual(['No Laravel Vapor token yet. Add one in the settings, then come back here.'])
    expect(listVaporProjects).not.toHaveBeenCalled()

    view.press('Open the Laravel Vapor settings')
    expect(openPreference).toHaveBeenCalledWith('vapor')

    view.done()
  })

  test('lists the teams, and the projects and environments under them', async () => {
    const view = render({is_vapor: true, vapor_team_id: 'team-1', vapor_project_id: 'proj-1'}, {
      vaporStatus: async () => saved,
      listVaporProjects: async () => ({ok: true, teams}),
    })

    await settle()

    expect(view.options('connection-vapor-team')).toEqual([
      ['', 'Choose a team'],
      ['team-1', 'Acme'],
      ['team-2', 'Other'],
    ])

    expect(view.options('connection-vapor-project')).toEqual([
      ['', 'Choose a project'],
      ['proj-1', 'shop'],
    ])

    // the address is what a run answers from, so it is beside the name
    expect(view.options('connection-vapor-environment')).toEqual([
      ['', 'Choose an environment'],
      ['env-1', 'main · shop.example.com'],
      ['env-2', 'staging · staging-shop.example.com'],
    ])

    view.done()
  })

  test('a chosen team, project and environment are what the form saves', async () => {
    const view = render({is_vapor: true, name: 'New Connection'}, {
      vaporStatus: async () => saved,
      listVaporProjects: async () => ({ok: true, teams}),
    })

    await settle()

    view.choose('connection-vapor-team', 'team-1')

    await settle()

    view.choose('connection-vapor-project', 'proj-1')

    await settle()

    view.choose('connection-vapor-environment', 'env-2')

    const values = view.values()

    expect(values.vapor_team_id).toBe('team-1')
    expect(values.vapor_project_id).toBe('proj-1')
    expect(values.vapor_project_name).toBe('shop')
    expect(values.vapor_environment_id).toBe('env-2')
    expect(values.vapor_environment_name).toBe('staging')
    // the dialog opens on the default name, which is a label rather than a
    // choice: the project and the environment are what name the connection
    expect(values.name).toBe('shop · staging')

    view.done()
  })

  // a project belongs to one team and an environment to one project: what was
  // chosen under the old one is not the new one's to keep
  test('choosing another team clears the project and the environment', async () => {
    const view = render({
      is_vapor: true,
      vapor_team_id: 'team-1',
      vapor_project_id: 'proj-1',
      vapor_project_name: 'shop',
      vapor_environment_id: 'env-2',
      vapor_environment_name: 'staging',
    }, {
      vaporStatus: async () => saved,
      listVaporProjects: async () => ({ok: true, teams}),
    })

    await settle()

    view.choose('connection-vapor-team', 'team-2')

    const values = view.values()

    expect(values.vapor_team_id).toBe('team-2')
    expect(values.vapor_project_id).toBe('')
    expect(values.vapor_project_name).toBe('')
    expect(values.vapor_environment_id).toBe('')
    expect(values.vapor_environment_name).toBe('')

    view.done()
  })

  // a saved environment that the project no longer lists is shown as missing
  // rather than cleared: the connection is not edited behind the person's back
  test('a saved environment the project no longer has is shown, not cleared', async () => {
    const view = render({
      is_vapor: true,
      vapor_team_id: 'team-1',
      vapor_project_id: 'proj-1',
      vapor_project_name: 'shop',
      vapor_environment_id: 'env-gone',
      vapor_environment_name: 'feature-x',
    }, {
      vaporStatus: async () => saved,
      listVaporProjects: async () => ({ok: true, teams}),
    })

    await settle()

    expect(view.options('connection-vapor-environment')).toEqual([
      ['', 'Choose an environment'],
      ['env-gone', 'feature-x (missing)'],
      ['env-1', 'main · shop.example.com'],
      ['env-2', 'staging · staging-shop.example.com'],
    ])

    expect(view.notes()).toContain('feature-x is not in this project any more. Choose another environment.')
    expect(view.values().vapor_environment_id).toBe('env-gone')

    view.done()
  })

  test('a read that failed says so, and asks again when it is told to', async () => {
    const listVaporProjects = jest.fn()
      .mockResolvedValueOnce({ok: false, error: {code: 'unauthorized', message: 'This token is not valid.'}})
      .mockResolvedValueOnce({ok: true, teams})

    const view = render({is_vapor: true}, {
      vaporStatus: async () => saved,
      listVaporProjects,
    })

    await settle()

    expect(view.notes()).toEqual(['This token is not valid.'])

    view.press('Try again')

    await settle()

    expect(view.options('connection-vapor-team')).toEqual([
      ['', 'Choose a team'],
      ['team-1', 'Acme'],
      ['team-2', 'Other'],
    ])

    view.done()
  })
})
