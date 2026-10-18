/**
 * The logs window: a window of the app's own kind, and only ever one of it.
 *
 * Electron is replaced rather than driven — a test cannot raise a real window —
 * so what is checked is what the window is asked for and what a second press
 * does.
 */
// the mock's own state has to live inside the factory: jest hoists it above the
// module and refuses one that closes over the test's variables
jest.mock('electron', () => {
  class FakeWindow {
    constructor(options) {
      this.options = options
      this.destroyed = false
      this.shown = false
      this.listeners = {}
      this.loaded = null
      FakeWindow.created.push(this)
    }

    isDestroyed() {
      return this.destroyed
    }

    focus() {
      FakeWindow.focused++
    }

    show() {
      this.shown = true
    }

    loadURL(url) {
      this.loaded = url
    }

    setTitle() {}

    on(event, listener) {
      this.listeners[event] = listener
    }

    // what closing a window does to the one the app remembers
    close() {
      this.destroyed = true
      if (this.listeners.closed) {
        this.listeners.closed()
      }
    }

    static getFocusedWindow() {
      return null
    }

    static getAllWindows() {
      return FakeWindow.created.filter(one => !one.destroyed)
    }
  }

  FakeWindow.created = []
  FakeWindow.focused = 0

  return {BrowserWindow: FakeWindow, app: {getLocale: () => 'en'}}
})

jest.mock('../utils/entryUrl', () => ({
  getEntryUrl: page => `app://${page}`,
  getPreloadEntryUrl: () => 'app://preload.js',
}))

jest.mock('../utils/frame', () => ({frameOf: () => ({frame: false})}))
jest.mock('../utils/devIcon', () => ({devIcon: () => ({})}))
jest.mock('../locale', () => ({getIntl: () => ({formatMessage: ({id}) => id})}))
jest.mock('../constants', () => ({appName: 'Tinkr'}))

const {BrowserWindow} = require('electron')
const {createLogsWindow, getLogsWindow} = require('../createLogsWindow')

const created = BrowserWindow.created

const connection = {id: 'abc', name: 'app', path: '/var/www/app'}

beforeEach(() => {
  // a close of anything left over, so one test's window is not the next one's
  created.slice().forEach(one => one.destroyed || one.close())
  created.length = 0
  BrowserWindow.focused = 0
})

describe('the logs window', () => {
  test('is opened on the connection it was asked for', () => {
    createLogsWindow(connection)

    expect(created.length).toBe(1)
    expect(created[0].loaded).toBe('app://logs.html?id=abc')
  })

  test('is one window, however many times the button is pressed', () => {
    const first = createLogsWindow(connection)

    createLogsWindow(connection)
    createLogsWindow(connection)

    // the same window every time, and the presses that found it raised it
    expect(created.length).toBe(1)
    expect(getLogsWindow()).toBe(first)
    expect(BrowserWindow.focused).toBe(2)
  })

  test('is opened again once it has been closed', () => {
    createLogsWindow(connection).close()

    expect(getLogsWindow()).toBe(null)

    createLogsWindow(connection)

    expect(created.length).toBe(2)
    expect(getLogsWindow()).toBe(created[1])
  })

  test('carries the connection of the press that opened it after a close', () => {
    const first = createLogsWindow(connection)

    first.close()
    // the editor window has switched connection by now, and its logs are another
    // project's: what the window is opened on is what was asked for
    createLogsWindow({id: 'def', name: 'other', path: '/var/www/other'})

    expect(created[1].loaded).toBe('app://logs.html?id=def')
  })

  test('wears the app\'s own frame, as every other window does', () => {
    createLogsWindow(connection)

    expect(created[0].options.frame).toBe(false)
    expect(created[0].options.webPreferences.preload).toBe('app://preload.js')
    expect(created[0].options.webPreferences.contextIsolation).toBe(true)
  })
})
