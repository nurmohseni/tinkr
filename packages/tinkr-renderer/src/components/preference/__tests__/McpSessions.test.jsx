import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'

global.React = React

// the component's own module reads the bridge at import time, and the settings
// window's calls are not what these tests are about
jest.mock('../../../utils/api', () => ({
  allConnections: () => ({}),
  clearMcpSessions: jest.fn(),
  mcpSession: jest.fn(),
  mcpSessions: jest.fn(() => []),
  openMcpCall: jest.fn(),
}))

const english = require('../../../../../tinkr-main/src/lang/en.json')
const {Call, openableOf} = require('../McpSessions')

const call = {
  tool: 'tinkr_run_php',
  at: new Date(2026, 9, 31, 14, 32).getTime(),
  ms: 120,
  outcome: 'returned',
  connection: {id: 'fixture', name: 'Fixture', tag: 'local'},
  code: '1 + 1;',
}

const render = (one = call, ids = ['fixture']) => renderToStaticMarkup(
  <IntlProvider
    locale='en'
    messages={flatten(english)}
  >
    <Call
      call={one}
      connectionIds={new Set(ids)}
      onOpen={() => {}}
    />
  </IntlProvider>,
)

describe('the rules for opening a call in the editor', () => {
  test('a call with a saved connection opens', () => {
    expect(openableOf(call, new Set(['fixture']))).toBe('open')
  })

  test('a call whose connection is no longer saved has nowhere to open', () => {
    expect(openableOf(call, new Set(['other']))).toBe('gone')
  })

  test('a call that ran in no saved connection says so', () => {
    expect(openableOf({...call, connection: null}, new Set(['fixture']))).toBe('no-connection')
    expect(openableOf({...call, connection: {name: 'a directory'}}, new Set(['fixture']))).toBe('no-connection')
    // the server names a bare directory `cwd`: it was never a connection, so it
    // is not one that has gone
    expect(openableOf({...call, connection: {id: 'cwd', name: 'project'}}, new Set(['fixture']))).toBe('no-connection')
  })

  test('a call with no code has nothing to open', () => {
    expect(openableOf({...call, code: ''}, new Set(['fixture']))).toBe(null)
    expect(openableOf({...call, code: '   '}, new Set(['fixture']))).toBe(null)
    expect(openableOf({...call, code: undefined}, new Set(['fixture']))).toBe(null)
  })

  test('a call whose code the journal cut is not opened as if it were whole', () => {
    expect(openableOf({...call, code_cut: true}, new Set(['fixture']))).toBe('cut')
    expect(render({...call, code_cut: true})).not.toContain('Open in editor')
    expect(render({...call, code_cut: true})).toContain('Only the start of this code was kept')
  })
})

describe('a call opened in the settings screen', () => {
  test('offers the editor for its code when its connection is saved', () => {
    const markup = render()

    expect(markup).toContain('Open in editor')
    expect(markup).toContain('type="button"')
    expect(markup).toContain('btn--ghost')
    expect(markup).not.toContain('no longer saved')
    expect(markup).not.toContain('no saved connection')
  })

  test('says the connection is gone instead of offering a button', () => {
    const markup = render(call, ['other'])

    expect(markup).not.toContain('Open in editor')
    expect(markup).toContain('Fixture is no longer saved, so this code has nowhere to open.')
  })

  test('says there is no saved connection for a run in a directory', () => {
    const markup = render({...call, connection: {id: 'cwd', name: 'project', tag: 'local'}}, [])

    expect(markup).not.toContain('Open in editor')
    expect(markup).toContain('This call has no saved connection to open its code in.')
  })

  test('shows neither a button nor a reason for a call with no code', () => {
    const markup = render({...call, code: undefined, error: 'it threw', outcome: 'threw'})

    expect(markup).not.toContain('Open in editor')
    expect(markup).not.toContain('no saved connection')
    expect(markup).toContain('it threw')
  })
})
