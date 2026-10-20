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

  test('a range is found in the file, and paging stops at its edges rather than the file\'s', async () => {
    // the service finds the range and answers with where it sits, which is the
    // whole of what the store needs: the window it returned ends at the range's
    // own end, and paging then stops at the range's own start
    const from = 0
    const to = 2 * logs.defaultBytes

    api.logRead.mockImplementation((name, options = {}) => {
      const bytes = options.bytes || logs.defaultBytes
      const end = options.before == null ? to : Math.min(options.before, to)
      const start = Math.max(end - bytes, from)

      return {file: name, size: size(logs), read: end - start, from: start, range: {from, to}, entries: []}
    })

    await store.set(logs.loadLogsAtom)

    const state = store.get(logs.logsAtom)

    // it opened on the end of the range, not the end of the file
    expect(state.from).toBe(to - logs.defaultBytes)
    expect(logs.atEnd(state)).toBe(true)
    expect(logs.atStart(state)).toBe(false)

    // stepping back reaches the range's own start and stops there
    await store.set(logs.olderLogAtom)

    expect(store.get(logs.logsAtom).from).toBe(from)
    expect(logs.atStart(store.get(logs.logsAtom))).toBe(true)
    expect(logs.atEnd(store.get(logs.logsAtom))).toBe(false)

    await store.set(logs.olderLogAtom)

    expect(store.get(logs.logsAtom).from).toBe(from)
    // the step back asked for the window before the one in view, which starts
    // where the range's second window does
    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {bytes: logs.defaultBytes, before: logs.defaultBytes, since: '', until: ''})
  })

  test('setting a range asks the service for it, and clearing it asks for the whole file again', async () => {
    await store.set(logs.loadLogsAtom)
    await store.set(logs.setLogRangeAtom, {since: '2026-08-27 06:00:00', until: '2026-08-27 08:30:00'})

    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {since: '2026-08-27 06:00:00', until: '2026-08-27 08:30:00'})
    expect(store.get(logs.logsRangedAtom)).toBe(true)

    await store.set(logs.clearLogRangeAtom)

    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {since: '', until: ''})
    expect(store.get(logs.logsRangedAtom)).toBe(false)
  })

  test('a step back reads the window before this one, and a step forward reads it again', async () => {
    await store.set(logs.loadLogsAtom)
    await store.set(logs.olderLogAtom)

    const back = store.get(logs.logsAtom)

    expect(back.from).toBe(logs.defaultBytes)
    expect(back.read).toBe(logs.defaultBytes)
    // every read carries the range, which is empty until one is set
    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {bytes: logs.defaultBytes, before: 2 * logs.defaultBytes, since: '', until: ''})
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
    // every read carries the range, which is empty until one is set
    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {bytes: logs.defaultBytes, before: 2 * logs.defaultBytes, since: '', until: ''})

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

  test('a level is shown unless the filter left it out', () => {
    expect(logs.passesLevel([], 'info')).toBe(true)
    expect(logs.passesLevel(['debug'], 'info')).toBe(true)
    expect(logs.passesLevel(['debug'], 'debug')).toBe(false)
  })

  test('there is nothing to step through before a file is open', async () => {
    await store.set(logs.olderLogAtom)
    await store.set(logs.newerLogAtom)

    expect(api.logRead).not.toHaveBeenCalled()
    expect(store.get(logs.logsAtom)).toEqual(logs.emptyLogs())
  })
})
