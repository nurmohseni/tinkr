// what Laravel Cloud answers is written to the window only while that window is
// still the connection's: the app switches connections in the one window it
// keeps, so an answer that arrives after the switch belongs to nobody
jest.mock('tinkr-core', () => ({cloudEnvironment: jest.fn()}))
jest.mock('../../database/secrets', () => ({cloudToken: jest.fn(() => 'token')}))

const {cloudEnvironment} = require('tinkr-core')
const {connectCloud} = require('../cloudConnection')
const {setEditorWindow} = require('../../processes')

// Laravel Cloud is asked over the network, so the answer is held until the test
// says when it lands and what it says
const deferred = () => {
  let resolve, reject

  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })

  return {promise, resolve, reject}
}

describe('connecting to Laravel Cloud', () => {
  const win = {webContents: {send: jest.fn()}, isDestroyed: () => false}
  const connection = {id: 'cloud', name: 'App', cloud_environment_id: 'env-1'}

  beforeEach(() => {
    cloudEnvironment.mockClear()
    win.webContents.send.mockClear()
  })

  afterEach(() => {
    setEditorWindow('cloud', null)
  })

  test('says what the environment is in the window still showing it', async () => {
    const answer = deferred()

    cloudEnvironment.mockReturnValue(answer.promise)
    setEditorWindow('cloud', win)

    const connecting = connectCloud(connection, win)

    answer.resolve({name: 'Production', status: 'running', phpVersion: '8.3'})
    await connecting

    expect(win.webContents.send).toHaveBeenCalledWith(
      'outputConnection',
      'Laravel Cloud · App / Production (running)\n'
    )
    expect(win.webContents.send).toHaveBeenCalledWith('phpVersion', {version: '8.3'})
  })

  // the bug this waits against: the window had switched to another connection by
  // the time Laravel Cloud answered, and the answer was written into the window
  // that now shows that other connection — its php in the status bar and a line
  // of Laravel Cloud's terminal in its pane
  test('writes nothing when the window switched connection before the answer', async () => {
    const answer = deferred()
    const switched = {webContents: {send: jest.fn()}, isDestroyed: () => false}

    cloudEnvironment.mockReturnValue(answer.promise)
    setEditorWindow('cloud', win)

    const connecting = connectCloud(connection, win)

    setEditorWindow('cloud', switched)

    answer.resolve({name: 'Production', status: 'running', phpVersion: '8.3'})
    await connecting

    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(switched.webContents.send).not.toHaveBeenCalled()
  })

  // a failure is answered with the same line the terminal would show, so it is
  // held back by the same rule: it is not this window's line any more either
  test('writes nothing when the window switched connection and the question failed', async () => {
    const answer = deferred()
    const switched = {webContents: {send: jest.fn()}, isDestroyed: () => false}

    cloudEnvironment.mockReturnValue(answer.promise)
    setEditorWindow('cloud', win)

    const connecting = connectCloud(connection, win)

    setEditorWindow('cloud', switched)

    answer.reject(new Error('Laravel Cloud is unavailable'))
    await connecting

    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(switched.webContents.send).not.toHaveBeenCalled()
  })
})
