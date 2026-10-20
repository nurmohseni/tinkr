import {createStore} from 'jotai'

// The stores read the connection's logs out of the main process, and the module
// reads window.api as it is loaded, so it has to be in place first.
describe('logs store', () => {
  let api
  let store
  let logs
  let total

  // six pages, which is more than the viewer holds, so the caps are exercised
  const pages = root => 6 * root.defaultBytes

  beforeEach(() => {
    api = {
      logFiles: jest.fn(),
      logRead: jest.fn(),
    }

    window.api = api
    jest.resetModules()

    logs = require('../logs')
    store = createStore()
    total = pages(logs)

    api.logFiles.mockImplementation(() => ({
      dir: '/app/storage/logs',
      files: [{name: 'laravel.log', size: total, at: 1}],
    }))

    api.logRead.mockImplementation((name, options = {}) => {
      const bytes = options.bytes || logs.defaultBytes
      let start

      if (options.after != null) {
        start = Math.min(options.after, total)
      } else {
        const end = options.before == null ? total : Math.min(options.before, total)

        start = Math.max(end - bytes, 0)
      }

      const end = Math.min(start + bytes, total)

      return {
        file: name,
        size: total,
        read: end - start,
        from: start,
        range: {from: 0, to: total},
        entries: start < end ? [{page: start / logs.defaultBytes}] : [],
      }
    })
  })

  test('opens on the end of the file, with one page', async () => {
    await store.set(logs.loadLogsAtom)

    const state = store.get(logs.logsAtom)

    expect(state.file).toBe('laravel.log')
    expect(state.pages).toHaveLength(1)
    expect(state.from).toBe(5 * logs.defaultBytes)
    expect(state.read).toBe(logs.defaultBytes)
    expect(state.size).toBe(total)
    expect(state.entries).toHaveLength(1)
    expect(logs.atEnd(state)).toBe(true)
    expect(logs.atStart(state)).toBe(false)
  })

  test('loading older pages prepends them, and the joined window still reaches the end', async () => {
    await store.set(logs.loadLogsAtom)
    await store.set(logs.olderLogAtom)

    const state = store.get(logs.logsAtom)

    expect(state.pages).toHaveLength(2)
    expect(state.from).toBe(4 * logs.defaultBytes)
    expect(state.read).toBe(2 * logs.defaultBytes)
    expect(state.entries.map(entry => entry.page)).toEqual([4, 5])
    expect(logs.atEnd(state)).toBe(true)
    expect(logs.atStart(state)).toBe(false)
    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {
      bytes: logs.defaultBytes,
      before: 5 * logs.defaultBytes,
      since: '',
      until: '',
    })
  })

  test('the page cap drops the newest pages as the reader walks back, and stops at the start', async () => {
    await store.set(logs.loadLogsAtom)

    // page 5 is the first page; four more walks back reach the oldest page and
    // the cap has dropped the pages the reader left behind
    for (let at = 0; at < 5; at++) {
      await store.set(logs.olderLogAtom)
    }

    const state = store.get(logs.logsAtom)

    expect(state.pages).toHaveLength(logs.maxPages)
    expect(state.from).toBe(0)
    expect(logs.atStart(state)).toBe(true)
    expect(logs.atEnd(state)).toBe(false)
    expect(state.entries.length).toBeLessThanOrEqual(logs.maxEntries)

    // a page that made no progress is not kept
    const pagesHeld = state.pages.length
    await store.set(logs.olderLogAtom)

    expect(store.get(logs.logsAtom).pages).toHaveLength(pagesHeld)
  })

  test('loading newer pages appends from where the held window ends, and the cap drops the oldest', async () => {
    await store.set(logs.loadLogsAtom)

    // walk back until the newest page has been dropped
    for (let at = 0; at < 4; at++) {
      await store.set(logs.olderLogAtom)
    }

    const back = store.get(logs.logsAtom)

    expect(logs.atEnd(back)).toBe(false)

    const last = back.pages[back.pages.length - 1]

    await store.set(logs.newerLogAtom)

    const forward = store.get(logs.logsAtom)

    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {
      bytes: logs.defaultBytes,
      after: last.from + last.read,
      since: '',
      until: '',
    })
    expect(forward.pages).toHaveLength(logs.maxPages)
    expect(logs.atEnd(forward)).toBe(true)
    expect(forward.from).toBeGreaterThan(back.from)
  })

  test('the page cap also holds by entries, not only by pages', async () => {
    const entries = Array.from({length: 1200}, (unused, at) => ({at}))

    total = 4 * 100
    api.logFiles.mockImplementation(() => ({
      dir: '/app/storage/logs',
      files: [{name: 'laravel.log', size: total, at: 1}],
    }))
    api.logRead.mockImplementation((name, options = {}) => {
      const from = options.before == null
        ? total - 100
        : Math.max(Math.min(options.before, total) - 100, 0)

      return {file: name, size: total, read: 100, from, range: {from: 0, to: total}, entries}
    })

    await store.set(logs.loadLogsAtom)
    await store.set(logs.olderLogAtom)
    await store.set(logs.olderLogAtom)

    const state = store.get(logs.logsAtom)

    expect(state.pages.length).toBeLessThan(logs.maxPages)
    expect(state.entries.length).toBeLessThanOrEqual(logs.maxEntries)
  })

  test('a range is found in the file, and paging stops at its edges', async () => {
    const from = 0
    const to = 4 * logs.defaultBytes

    total = 6 * logs.defaultBytes
    api.logRead.mockImplementation((name, options = {}) => {
      const bytes = options.bytes || logs.defaultBytes
      const at = options.after != null
        ? Math.min(Math.max(options.after, from), to)
        : Math.max(Math.min(options.before == null ? to : options.before, to) - bytes, from)
      const end = Math.min(at + bytes, to)

      return {
        file: name,
        size: total,
        read: end - at,
        from: at,
        range: {from, to},
        entries: at < end ? [{page: at / logs.defaultBytes}] : [],
      }
    })

    await store.set(logs.loadLogsAtom)

    const state = store.get(logs.logsAtom)

    expect(state.from).toBe(to - logs.defaultBytes)
    expect(logs.atEnd(state)).toBe(true)

    await store.set(logs.olderLogAtom)

    expect(store.get(logs.logsAtom).from).toBe(to - 2 * logs.defaultBytes)

    await store.set(logs.olderLogAtom)
    await store.set(logs.olderLogAtom)
    await store.set(logs.olderLogAtom)

    const start = store.get(logs.logsAtom)

    expect(start.from).toBe(from)
    expect(logs.atStart(start)).toBe(true)
    // the range is exactly the pages held, so its two edges are both here
    expect(logs.atEnd(start)).toBe(true)
  })

  test('a range is asked for with every page, and clearing it reads the whole file again', async () => {
    await store.set(logs.loadLogsAtom)
    await store.set(logs.setLogRangeAtom, {since: '2026-08-27 06:00:00', until: '2026-08-27 08:30:00'})

    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {
      bytes: logs.defaultBytes,
      since: '2026-08-27 06:00:00',
      until: '2026-08-27 08:30:00',
    })
    expect(store.get(logs.logsRangedAtom)).toBe(true)

    await store.set(logs.clearLogRangeAtom)

    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {bytes: logs.defaultBytes, since: '', until: ''})
    expect(store.get(logs.logsRangedAtom)).toBe(false)
  })

  test('following reads after the held end and keeps the pages the reader has', async () => {
    await store.set(logs.loadLogsAtom)
    store.set(logs.logsFollowAtom, true)

    await store.set(logs.followLogAtom)

    // nothing was appended, but following is still on the end
    expect(store.get(logs.logsFollowAtom)).toBe(true)
    expect(api.logRead).toHaveBeenLastCalledWith('laravel.log', {
      bytes: logs.defaultBytes,
      after: total,
      since: '',
      until: '',
    })

    // the file grew: the new page is joined below what was held
    total = 7 * logs.defaultBytes
    await store.set(logs.followLogAtom)

    expect(store.get(logs.logsAtom).pages).toHaveLength(2)
    expect(store.get(logs.logsAtom).from).toBe(5 * logs.defaultBytes)
    expect(logs.atEnd(store.get(logs.logsAtom))).toBe(true)
  })

  test('a page that has left the end of the file turns following off', async () => {
    await store.set(logs.loadLogsAtom)
    store.set(logs.logsFollowAtom, true)

    // enough walks back to drop the newest page
    for (let at = 0; at < 4; at++) {
      await store.set(logs.olderLogAtom)
    }

    expect(store.get(logs.logsFollowAtom)).toBe(false)
  })

  test('a level is shown unless the filter left it out', () => {
    expect(logs.passesLevel([], 'info')).toBe(true)
    expect(logs.passesLevel(['debug'], 'info')).toBe(true)
    expect(logs.passesLevel(['debug'], 'debug')).toBe(false)
  })

  test('there is nothing to read before a file is open', async () => {
    await store.set(logs.olderLogAtom)
    await store.set(logs.newerLogAtom)
    await store.set(logs.followLogAtom)

    expect(api.logRead).not.toHaveBeenCalled()
    expect(store.get(logs.logsAtom)).toEqual(logs.emptyLogs())
  })
})
