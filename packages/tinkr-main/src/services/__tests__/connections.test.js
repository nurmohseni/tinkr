// what a reconnect does to the session and to the window is what this is about:
// the stores, the dialogs and the sessions of other connections are not
jest.mock('../../database/connections', () => ({
  connections: new Map(),
  sessionConnection: connection => connection,
}))
jest.mock('../../database/config', () => ({config: {get: () => null}}))
jest.mock('../../database/secrets', () => ({keptConnection: c => c, forget: jest.fn()}))
jest.mock('../../createEditorWindow', () => ({createEditorWindow: jest.fn()}))
jest.mock('../../createPty', () => ({createPty: jest.fn()}))
jest.mock('../../createBackgroundPty', () => ({createBackgroundPty: jest.fn()}))
jest.mock('../phpVersion', () => ({detectPhpVersion: jest.fn()}))
jest.mock('../cloudConnection', () => ({connectCloud: jest.fn(() => Promise.resolve())}))
jest.mock('../snippetsWatch', () => ({watchSnippets: jest.fn()}))
jest.mock('../snippets', () => ({allSnippets: jest.fn(() => [])}))

const {reconnectConnection} = require('../connections')
const {connectCloud} = require('../cloudConnection')
const {createPty} = require('../../createPty')
const {detectPhpVersion} = require('../phpVersion')
const {
  getPtyProcess,
  setPtyProcess,
  setEditorWindow,
  setEditorConnection,
} = require('../../processes')

describe('reconnecting a connection', () => {
  const win = {webContents: {send: jest.fn()}, isDestroyed: () => false}

  beforeEach(() => {
    connectCloud.mockClear()
    createPty.mockClear()
    detectPhpVersion.mockClear()
    win.webContents.send.mockClear()
  })

  afterEach(() => {
    setPtyProcess('cloud', null)
    setPtyProcess('local', null)
    setEditorWindow('cloud', null)
    setEditorWindow('local', null)
    setEditorConnection('cloud', null)
    setEditorConnection('local', null)
  })

  // the bug this waits against: a reconnect killed a pending cloud run and
  // cleared its handle before the abort the kill caused could be written, so
  // the pane stayed in flight for a run whose answer had nowhere to go
  test('keeps a pending cloud run owned until its answer lands', () => {
    const connection = {id: 'cloud', is_cloud: true, cloud_environment_id: 'env-1'}
    const kill = jest.fn()

    setEditorWindow('cloud', win)
    setPtyProcess('cloud', {kill, running: true})

    reconnectConnection(connection)

    // the wait for the command is ended, and the rejection that answers with it
    // is still this connection's to write
    expect(kill).toHaveBeenCalledTimes(1)
    expect(getPtyProcess('cloud')).not.toBe(null)
    expect(connectCloud).toHaveBeenCalledWith(connection, win)
    expect(createPty).not.toHaveBeenCalled()
  })

  test('clears a cloud handle that was left with no run', () => {
    const connection = {id: 'cloud', is_cloud: true, cloud_environment_id: 'env-1'}
    const kill = jest.fn()

    setEditorWindow('cloud', win)
    setPtyProcess('cloud', {kill, running: false})

    reconnectConnection(connection)

    expect(kill).toHaveBeenCalledTimes(1)
    expect(getPtyProcess('cloud')).toBe(null)
  })

  // a session has a shell to boot again, so its old one is killed and dropped
  // before the new one is created
  test('replaces the session of a connection that is not on the cloud', () => {
    const connection = {id: 'local', path: '/var/www/app'}
    const kill = jest.fn()

    setEditorWindow('local', win)
    setPtyProcess('local', {kill, running: false})

    reconnectConnection(connection)

    expect(kill).toHaveBeenCalledTimes(1)
    expect(getPtyProcess('local')).toBe(null)
    expect(createPty).toHaveBeenCalledWith(connection)
    expect(detectPhpVersion).toHaveBeenCalledWith(connection, win)
  })
})
