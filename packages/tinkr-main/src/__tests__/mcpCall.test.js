jest.mock('../database/connections', () => ({
  connections: {get: jest.fn()},
}))

jest.mock('../processes', () => ({
  getCurrentEditorWindow: jest.fn(),
  getEditorConnectionId: jest.fn(),
}))

jest.mock('../services/connections', () => ({
  connectConnection: jest.fn(),
}))

jest.mock('../createEditorWindow', () => ({
  createEditorWindow: jest.fn(),
}))

const {connections} = require('../database/connections')
const {getCurrentEditorWindow, getEditorConnectionId} = require('../processes')
const {connectConnection} = require('../services/connections')
const {createEditorWindow} = require('../createEditorWindow')
const {openCall} = require('../services/mcpCall')

const connection = {id: 'fixture', name: 'Fixture', path: '/app', tag: 'local'}

const fakeWindow = () => ({
  isDestroyed: () => false,
  isMinimized: () => false,
  show: jest.fn(),
  focus: jest.fn(),
  restore: jest.fn(),
  webContents: {send: jest.fn()},
})

const request = {
  connectionId: 'fixture',
  name: 'tinkr_run_php · 14:32',
  code: '1 + 1;',
}

describe('opening a call in the editor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    connections.get.mockReturnValue(connection)
  })

  test('refuses a call with no code', async () => {
    expect(await openCall({connectionId: 'fixture', name: 'x', code: ''})).toEqual({
      opened: false,
      reason: 'no-code',
    })
    expect(connections.get).not.toHaveBeenCalled()
    expect(getCurrentEditorWindow).not.toHaveBeenCalled()
  })

  test('refuses a connection the app does not have, without opening a window', async () => {
    connections.get.mockReturnValue(undefined)

    expect(await openCall({...request, connectionId: 'gone'})).toEqual({
      opened: false,
      reason: 'no-connection',
    })
    expect(createEditorWindow).not.toHaveBeenCalled()
    expect(connectConnection).not.toHaveBeenCalled()
  })

  test('switches a window on another connection, then sends the call to it', async () => {
    const win = fakeWindow()
    const second = {...connection, id: 'second', name: 'Second'}

    connections.get.mockReturnValue(second)
    getCurrentEditorWindow.mockReturnValue(win)
    getEditorConnectionId.mockReturnValue('fixture')
    connectConnection.mockResolvedValue()

    expect(await openCall({...request, connectionId: 'second'})).toEqual({opened: true})

    expect(connections.get).toHaveBeenCalledWith('second', null)
    expect(connectConnection).toHaveBeenCalledWith(second)
    // the tab follows the switch: the switch's message cannot arrive after the
    // one that starts it
    expect(connectConnection.mock.invocationCallOrder[0])
      .toBeLessThan(win.webContents.send.mock.invocationCallOrder[0])
    expect(win.webContents.send).toHaveBeenCalledWith('openMcpCall', {
      name: 'tinkr_run_php · 14:32',
      code: '1 + 1;',
    })
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  test('leaves a window already on the connection alone', async () => {
    const win = fakeWindow()

    getCurrentEditorWindow.mockReturnValue(win)
    getEditorConnectionId.mockReturnValue('fixture')

    expect(await openCall(request)).toEqual({opened: true})
    // the switcher does nothing on the row of the connection on screen, and
    // neither does this: a run going in it is not disturbed
    expect(connectConnection).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('openMcpCall', {
      name: 'tinkr_run_php · 14:32',
      code: '1 + 1;',
    })
  })

  test('opens a window when the app has none, then sends the call to it', async () => {
    const win = fakeWindow()

    getCurrentEditorWindow.mockReturnValue(null)
    createEditorWindow.mockResolvedValue(win)

    expect(await openCall(request)).toEqual({opened: true})

    expect(createEditorWindow).toHaveBeenCalledWith(connection)
    expect(connectConnection).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('openMcpCall', {
      name: 'tinkr_run_php · 14:32',
      code: '1 + 1;',
    })
    expect(win.focus).toHaveBeenCalled()
  })

  test('restores a minimized window before raising it', async () => {
    const win = fakeWindow()

    win.isMinimized = () => true
    getCurrentEditorWindow.mockReturnValue(win)
    getEditorConnectionId.mockReturnValue('fixture')

    await openCall(request)

    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })
})
