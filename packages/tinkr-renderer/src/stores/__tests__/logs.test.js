import {createStore} from 'jotai'

// The stores read the connection's logs out of the main process, and the module
// reads window.api as it is loaded, so it has to be in place first.
describe('logs store', () => {
  let api
  let store
  let logs

  // what the service answers: a window of one size, three of them long, so the
  // middle window is away from both ends
  const size = root => 3 * root.defaultBytes

  beforeEach(() => {
    api = {
      logFiles: jest.fn(),
      logRead: jest.fn(),
    }

    window.api = api
    jest.resetModules()

    logs = require('../logs')
    store = createStore()

    api.logFiles.mockImplementation(() => ({
      dir: '/app/storage/logs',
      files: [{name: 'laravel.log', size: size(logs), at: 1}],
    }))

    api.logRead.mockImplementation((name, options = {}) => {
      const bytes = options.bytes || logs.defaultBytes
      const to = options.before == null ? size(logs) : Math.min(options.before, size(logs))
      const from = Math.max(to - bytes, 0)

      return {file: name, size: size(logs), read: to - from, from, entries: []}
    })
  })

  test('a window opens on the end of the file, and says that is where it is', async () => {
    await store.set(logs.loadLogsAtom)

    const state = store.get(logs.logsAtom)

    expect(state.file).toBe('laravel.log')
    expect(state.from).toBe(2 * logs.defaultBytes)
    expect(state.read).toBe(logs.defaultBytes)
    expect(state.size).toBe(3 * logs.defaultBytes)
    expect(logs.atEnd(state)).toBe(true)
    expect(logs.atStart(state)).toBe(false)
  })

  test('a step back reads the window before this one, and a step forward reads it again', async () => {
    await store.set(logs.loadLogsAtom)
    await store.set(logs.olderLogAtom)

    const back = store.get(logs.logsAtom)

    expect(back.from).toBe(logs.defaultBytes)
    expect(back.read).toBe(logs.defaultBytes)
    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {bytes: logs.defaultBytes, before: 2 * logs.defaultBytes})
    expect(logs.atEnd(back)).toBe(false)
    expect(logs.atStart(back)).toBe(false)

    // once more lands on the start of the file, and it does not step past it
    await store.set(logs.olderLogAtom)

    const start = store.get(logs.logsAtom)

    expect(start.from).toBe(0)
    expect(start.read).toBe(logs.defaultBytes)
    expect(logs.atStart(start)).toBe(true)
    expect(logs.atEnd(start)).toBe(false)

    await store.set(logs.olderLogAtom)

    expect(store.get(logs.logsAtom)).toEqual(start)

    // and stepping forward again lands on the middle window, then back at the end
    await store.set(logs.newerLogAtom)

    expect(store.get(logs.logsAtom).from).toBe(logs.defaultBytes)
    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {bytes: logs.defaultBytes, before: 2 * logs.defaultBytes})

    await store.set(logs.newerLogAtom)

    expect(store.get(logs.logsAtom).from).toBe(2 * logs.defaultBytes)
    expect(logs.atEnd(store.get(logs.logsAtom))).toBe(true)
  })

  test('a window that has left the end of the file is not one being followed', async () => {
    await store.set(logs.loadLogsAtom)
    store.set(logs.logsFollowAtom, true)

    await store.set(logs.olderLogAtom)

    expect(store.get(logs.logsFollowAtom)).toBe(false)
  })

  test('a window at the end of the file goes on being followed', async () => {
    await store.set(logs.loadLogsAtom)
    store.set(logs.logsFollowAtom, true)

    await store.set(logs.readLogAtom)

    expect(store.get(logs.logsFollowAtom)).toBe(true)
  })

  test('a window that has left the start of the file can be stepped back to it', async () => {
    store.set(logs.logsAtom, {file: 'laravel.log', entries: [], size: 3 * logs.defaultBytes, read: logs.defaultBytes, from: logs.defaultBytes})

    await store.set(logs.olderLogAtom)

    const start = store.get(logs.logsAtom)

    expect(start.from).toBe(0)
    expect(start.read).toBe(logs.defaultBytes)
  })

  test('there is nothing to step through before a file is open', async () => {
    await store.set(logs.olderLogAtom)
    await store.set(logs.newerLogAtom)

    expect(api.logRead).not.toHaveBeenCalled()
    expect(store.get(logs.logsAtom)).toEqual(logs.emptyLogs())
  })
})
