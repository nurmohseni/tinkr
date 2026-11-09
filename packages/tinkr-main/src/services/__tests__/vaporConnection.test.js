// what Laravel Vapor answers is written to the window only while that window is
// still the connection's: the app switches connections in the one window it
// keeps, so an answer that arrives after the switch belongs to nobody
jest.mock('tinkr-core', () => ({vaporEnvironments: jest.fn()}))
jest.mock('../../database/secrets', () => ({vaporToken: jest.fn(() => 'token')}))

const {vaporEnvironments} = require('tinkr-core')
const {connectVapor} = require('../vaporConnection')
const secrets = require('../../database/secrets')
const {setEditorWindow} = require('../../processes')

// Vapor is asked over the network, so the answer is held until the test says
// when it lands and what it says
const deferred = () => {
  let resolve, reject

  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })

  return {promise, resolve, reject}
}

// what Vapor answers for a project with one environment, which is what the
// connection was saved with
const environments = () => [{id: 'env-1', name: 'Production', domain: 'app.test'}]

describe('connecting to Laravel Vapor', () => {
  const win = {webContents: {send: jest.fn()}, isDestroyed: () => false}
  const connection = {
    id: 'vapor',
    name: 'App',
    is_vapor: true,
    vapor_project_id: 'proj-1',
    vapor_project_name: 'App',
    vapor_environment_id: 'env-1',
    vapor_environment_name: 'Production',
  }

  beforeEach(() => {
    vaporEnvironments.mockClear()
    win.webContents.send.mockClear()
    secrets.vaporToken.mockClear()
  })

  afterEach(() => {
    setEditorWindow('vapor', null)
  })

  test('says what the environment is in the window still showing it', async () => {
    const answer = deferred()

    vaporEnvironments.mockReturnValue(answer.promise)
    setEditorWindow('vapor', win)

    const connecting = connectVapor(connection, win)

    answer.resolve(environments())
    await connecting

    expect(vaporEnvironments).toHaveBeenCalledWith('token', 'proj-1')
    expect(win.webContents.send).toHaveBeenCalledWith(
      'outputConnection',
      'Laravel Vapor · App / Production\n'
    )
    // Vapor reports no php version for an environment, and the status bar is
    // told that rather than left showing the previous connection's
    expect(win.webContents.send).toHaveBeenCalledWith('phpVersion', {version: null, unknown: true})
  })

  // the bug this waits against: the window had switched to another connection by
  // the time Vapor answered, and the answer was written into the window that now
  // shows that other connection — its php in the status bar and a line of
  // Vapor's terminal in its pane
  test('writes nothing when the window switched connection before the answer', async () => {
    const answer = deferred()
    const switched = {webContents: {send: jest.fn()}, isDestroyed: () => false}

    vaporEnvironments.mockReturnValue(answer.promise)
    setEditorWindow('vapor', win)

    const connecting = connectVapor(connection, win)

    setEditorWindow('vapor', switched)

    answer.resolve(environments())
    await connecting

    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(switched.webContents.send).not.toHaveBeenCalled()
  })

  // a failure is answered with the same line the terminal would show, so it is
  // held back by the same rule: it is not this window's line any more either
  test('writes nothing when the window switched connection and the question failed', async () => {
    const answer = deferred()
    const switched = {webContents: {send: jest.fn()}, isDestroyed: () => false}

    vaporEnvironments.mockReturnValue(answer.promise)
    setEditorWindow('vapor', win)

    const connecting = connectVapor(connection, win)

    setEditorWindow('vapor', switched)

    answer.reject(new Error('Laravel Vapor is unavailable'))
    await connecting

    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(switched.webContents.send).not.toHaveBeenCalled()
  })

  test('says a token is needed when the app has none', async () => {
    secrets.vaporToken.mockReturnValueOnce('')
    setEditorWindow('vapor', win)

    await connectVapor(connection, win)

    expect(win.webContents.send).toHaveBeenCalledWith(
      'outputConnection',
      'Laravel Vapor: no API token is saved. Add one in Preferences → Laravel Vapor.\n'
    )
    expect(vaporEnvironments).not.toHaveBeenCalled()
  })

  test('says the connection names no environment', async () => {
    setEditorWindow('vapor', win)

    await connectVapor(Object.assign({}, connection, {vapor_environment_id: ''}), win)

    expect(win.webContents.send).toHaveBeenCalledWith(
      'outputConnection',
      'Laravel Vapor: this connection names no project and environment. Pick them in its settings.\n'
    )
    expect(vaporEnvironments).not.toHaveBeenCalled()
  })

  // the environment list is the project's, so an environment that is not in it
  // has been deleted: naming it anyway would be naming something to run in that
  // is not there
  test('says an environment the project no longer has is not there', async () => {
    vaporEnvironments.mockResolvedValue([{id: 'env-2', name: 'Staging', domain: 'staging.test'}])
    setEditorWindow('vapor', win)

    await connectVapor(connection, win)

    expect(win.webContents.send).toHaveBeenCalledWith(
      'outputConnection',
      'Laravel Vapor: Production is not in the project any more.\n'
    )
    expect(win.webContents.send).not.toHaveBeenCalledWith('phpVersion', expect.anything())
  })

  test('says what Vapor answered when the question failed', async () => {
    vaporEnvironments.mockRejectedValue(new Error('Laravel Vapor is unavailable'))
    setEditorWindow('vapor', win)

    await connectVapor(connection, win)

    expect(win.webContents.send).toHaveBeenCalledWith(
      'outputConnection',
      'Laravel Vapor: Laravel Vapor is unavailable\n'
    )
  })
})
