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

  // A read the test decides when to finish. The store's ownership is about
  // answers that land after a newer read, so the tests have to hold one open.
  const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((yes, no) => {
      resolve = yes
      reject = no
    })

    return {promise, resolve, reject}
  }

  const answer = (file, from, read, extra = {}) => Object.assign({
    file,
    size: total,
    from,
    read,
    range: {from: 0, to: total},
    entries: read > 0 ? [{page: from / logs.defaultBytes}] : [],
  }, extra)

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

    await store.set(logs.newerLogAtom)

    const forward = store.get(logs.logsAtom)

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

  test('a range narrows the read, and clearing it shows the whole file again', async () => {
    await store.set(logs.loadLogsAtom)
    await store.set(logs.setLogRangeAtom, {since: '2026-08-27 06:00:00', until: '2026-08-27 08:30:00'})

    expect(store.get(logs.logsRangedAtom)).toBe(true)
    expect(store.get(logs.logsSinceAtom)).toBe('2026-08-27 06:00:00')
    expect(store.get(logs.logsUntilAtom)).toBe('2026-08-27 08:30:00')
    // a range is a replacement, not a filter over the page already held
    expect(store.get(logs.logsAtom).pages).toHaveLength(1)

    await store.set(logs.clearLogRangeAtom)

    expect(store.get(logs.logsRangedAtom)).toBe(false)
    expect(store.get(logs.logsSinceAtom)).toBe('')
    expect(store.get(logs.logsUntilAtom)).toBe('')
  })

  test('following reads after the held end and keeps the pages the reader has', async () => {
    await store.set(logs.loadLogsAtom)
    store.set(logs.logsFollowAtom, true)

    await store.set(logs.followLogAtom)

    // nothing was appended, but following is still on the end
    expect(store.get(logs.logsFollowAtom)).toBe(true)
    expect(store.get(logs.logsAtom).loadingNewer).toBe(false)
    expect(store.get(logs.logsAtom).pages).toHaveLength(1)

    // the file grew: the new page is joined below what was held
    total = 7 * logs.defaultBytes
    await store.set(logs.followLogAtom)

    expect(store.get(logs.logsAtom).pages).toHaveLength(2)
    expect(store.get(logs.logsAtom).from).toBe(5 * logs.defaultBytes)
    expect(logs.atEnd(store.get(logs.logsAtom))).toBe(true)
  })

  test('following keeps reading from the same byte after a partial line', async () => {
    await store.set(logs.loadLogsAtom)
    store.set(logs.logsFollowAtom, true)

    const end = store.get(logs.logsAtom).from + store.get(logs.logsAtom).read
    const partial = deferred()
    const complete = deferred()

    api.logRead
      .mockImplementationOnce(() => partial.promise)
      .mockImplementationOnce(() => complete.promise)

    const first = store.set(logs.followLogAtom)

    // the file grew by half a line: no whole entry yet, and the window is now
    // short of the new end
    partial.resolve({
      file: 'laravel.log',
      size: end + 5,
      from: end,
      read: 0,
      range: {from: 0, to: end + 5},
      entries: [],
    })
    await first

    expect(store.get(logs.logsAtom).size).toBe(end + 5)
    expect(store.get(logs.logsAtom).from + store.get(logs.logsAtom).read).toBe(end)
    expect(logs.atEnd(store.get(logs.logsAtom))).toBe(false)

    const second = store.set(logs.followLogAtom)

    // the rest arrived: it is read from the byte the fragment started at
    complete.resolve({
      file: 'laravel.log',
      size: end + 15,
      from: end,
      read: 15,
      range: {from: 0, to: end + 15},
      entries: [{message: 'late'}],
    })
    await second

    const state = store.get(logs.logsAtom)

    expect(state.entries[state.entries.length - 1]).toEqual({message: 'late'})
    expect(logs.atEnd(state)).toBe(true)
  })

  test('a completed entry that overlaps the held end replaces its truncated copy', async () => {
    const held = {
      file: 'laravel.log',
      size: 100,
      from: 0,
      read: 100,
      range: {from: 0, to: 100},
      entries: [{message: 'first'}, {message: 'partial'}],
    }

    store.set(logs.logsAtom, Object.assign(logs.emptyLogs(), {
      file: 'laravel.log',
      size: 100,
      from: 0,
      read: 100,
      range: {from: 0, to: 100},
      pages: [held],
      entries: held.entries,
    }))

    api.logRead.mockResolvedValueOnce({
      file: 'laravel.log',
      size: 110,
      from: 80,
      read: 30,
      range: {from: 0, to: 110},
      entries: [{message: 'partial, complete'}, {message: 'new'}],
    })

    await store.set(logs.followLogAtom)

    const state = store.get(logs.logsAtom)

    // the page before the repeated entry stays, cut back to where that entry
    // starts; the entry itself comes back whole from the answer
    expect(state.pages).toHaveLength(2)
    expect(state.pages[0].read).toBe(80)
    expect(state.pages[0].entries).toEqual([{message: 'first'}])
    expect(state.pages[1].from).toBe(80)
    expect(state.pages[1].read).toBe(30)
    expect(state.entries).toEqual([
      {message: 'first'},
      {message: 'partial, complete'},
      {message: 'new'},
    ])
    expect(state.read).toBe(110)
    expect(logs.atEnd(state)).toBe(true)
  })

  test('a page cut back to zero bytes is dropped before the repeated entry is joined', async () => {
    const held = {
      file: 'laravel.log',
      size: 100,
      from: 0,
      read: 100,
      range: {from: 0, to: 100},
      entries: [{message: 'partial'}],
    }

    store.set(logs.logsAtom, Object.assign(logs.emptyLogs(), {
      file: 'laravel.log',
      size: 100,
      from: 0,
      read: 100,
      range: {from: 0, to: 100},
      pages: [held],
      entries: held.entries,
    }))

    api.logRead.mockResolvedValueOnce({
      file: 'laravel.log',
      size: 110,
      from: 0,
      read: 110,
      range: {from: 0, to: 110},
      entries: [{message: 'partial, complete'}, {message: 'new'}],
    })

    await store.set(logs.followLogAtom)

    const state = store.get(logs.logsAtom)

    expect(state.pages).toHaveLength(1)
    expect(state.pages[0].read).toBe(110)
    expect(state.entries).toEqual([{message: 'partial, complete'}, {message: 'new'}])
    expect(state.read).toBe(110)
  })

  test('a forward page after a blank line joins without trimming the held entry', async () => {
    const held = {
      file: 'laravel.log',
      size: 100,
      from: 0,
      read: 100,
      range: {from: 0, to: 100},
      entries: [{message: 'held'}],
    }

    store.set(logs.logsAtom, Object.assign(logs.emptyLogs(), {
      file: 'laravel.log',
      size: 100,
      from: 0,
      read: 100,
      range: {from: 0, to: 100},
      pages: [held],
      entries: held.entries,
    }))

    api.logRead.mockResolvedValueOnce({
      file: 'laravel.log',
      size: 140,
      from: 120,
      read: 20,
      range: {from: 0, to: 140},
      entries: [{message: 'after blank'}],
    })

    await store.set(logs.followLogAtom)

    const state = store.get(logs.logsAtom)

    // the bytes between the held page and the first entry after the blank line
    // have no entries of their own: the held page is not cut back for them
    expect(state.pages).toHaveLength(2)
    expect(state.pages[0].read).toBe(100)
    expect(state.pages[0].entries).toEqual([{message: 'held'}])
    expect(state.pages[1].from).toBe(120)
    expect(state.entries).toEqual([{message: 'held'}, {message: 'after blank'}])
    expect(state.read).toBe(140)
    expect(logs.atEnd(state)).toBe(true)
  })

  test('a filtered forward page starting after the cursor appends its own page', async () => {
    store.set(logs.logsAtom, Object.assign(logs.emptyLogs(), {file: 'laravel.log'}))

    api.logRead.mockResolvedValueOnce(answer('laravel.log', 0, 100, {
      size: 100,
      range: {from: 0, to: 100},
      entries: [{message: 'held'}],
    }))

    await store.set(logs.logsSearchAtom, 'boom')

    api.logRead.mockResolvedValueOnce({
      file: 'laravel.log',
      size: 140,
      from: 120,
      read: 20,
      range: {from: 0, to: 140},
      entries: [{message: 'after gap'}],
    })

    await store.set(logs.followLogAtom)

    const state = store.get(logs.logsAtom)

    expect(state.pages).toHaveLength(2)
    expect(state.pages[0].read).toBe(100)
    expect(state.pages[0].entries).toEqual([{message: 'held'}])
    expect(state.entries).toEqual([{message: 'held'}, {message: 'after gap'}])
    expect(state.read).toBe(140)
    expect(logs.atEnd(state)).toBe(true)
  })

  test('a filtered overlap rebuilds instead of dropping a held entry blindly', async () => {
    store.set(logs.logsAtom, Object.assign(logs.emptyLogs(), {file: 'laravel.log'}))

    api.logRead.mockResolvedValueOnce(answer('laravel.log', 0, 100, {
      size: 100,
      range: {from: 0, to: 100},
      entries: [{message: 'held'}],
    }))

    await store.set(logs.logsSearchAtom, 'boom')
    api.logRead.mockClear()

    api.logRead
      .mockResolvedValueOnce({
        file: 'laravel.log',
        size: 110,
        from: 80,
        read: 30,
        range: {from: 0, to: 110},
        entries: [{message: 'overlap'}],
      })
      .mockResolvedValueOnce({
        file: 'laravel.log',
        size: 110,
        from: 80,
        read: 30,
        range: {from: 0, to: 110},
        entries: [{message: 'replacement'}],
      })

    await store.set(logs.followLogAtom)

    expect(api.logRead).toHaveBeenCalledTimes(2)

    const state = store.get(logs.logsAtom)

    expect(state.pages).toHaveLength(1)
    expect(state.from).toBe(80)
    expect(state.entries).toEqual([{message: 'replacement'}])
  })

  test('an overlap reaching past the last page reads the end instead', async () => {
    const first = {
      file: 'laravel.log',
      size: 100,
      from: 0,
      read: 50,
      range: {from: 0, to: 100},
      entries: [{message: 'a'}],
    }
    const second = {
      file: 'laravel.log',
      size: 100,
      from: 50,
      read: 50,
      range: {from: 0, to: 100},
      entries: [{message: 'b'}],
    }

    store.set(logs.logsAtom, Object.assign(logs.emptyLogs(), {
      file: 'laravel.log',
      size: 100,
      from: 0,
      read: 100,
      range: {from: 0, to: 100},
      pages: [first, second],
      entries: [{message: 'a'}, {message: 'b'}],
    }))

    api.logRead
      .mockResolvedValueOnce({
        file: 'laravel.log',
        size: 110,
        from: 20,
        read: 90,
        range: {from: 0, to: 110},
        entries: [{message: 'overlap'}],
      })
      .mockResolvedValueOnce({
        file: 'laravel.log',
        size: 110,
        from: 80,
        read: 30,
        range: {from: 0, to: 110},
        entries: [{message: 'replacement'}],
      })

    await store.set(logs.followLogAtom)

    expect(api.logRead).toHaveBeenCalledTimes(2)

    const state = store.get(logs.logsAtom)

    expect(state.pages).toHaveLength(1)
    expect(state.from).toBe(80)
    expect(state.entries).toEqual([{message: 'replacement'}])
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

  test('following does not retry after an error until the reader asks again', async () => {
    await store.set(logs.loadLogsAtom)
    store.set(logs.logsFollowAtom, true)

    api.logRead.mockRejectedValueOnce(new Error('the log is gone'))
    await store.set(logs.followLogAtom)

    expect(store.get(logs.logsAtom).error).toBe('the log is gone')

    api.logRead.mockClear()
    await store.set(logs.followLogAtom)

    expect(api.logRead).not.toHaveBeenCalled()
  })


  test('viewer reads ask the whole file for the current filters', async () => {
    await store.set(logs.loadLogsAtom)
    api.logRead.mockClear()

    await store.set(logs.logsLevelsAtom, ['debug'])

    expect(api.logRead).toHaveBeenCalledTimes(1)
    expect(api.logRead.mock.calls[0][0]).toBe('laravel.log')
    expect(api.logRead.mock.calls[0][1]).toMatchObject({
      paginate: true,
      excludeLevels: ['debug'],
      term: '',
      limit: 100,
      bytes: logs.defaultBytes,
      since: '',
      until: '',
    })

    await store.set(logs.logsSearchAtom, 'certificate')

    expect(api.logRead.mock.calls[1][1]).toMatchObject({
      paginate: true,
      excludeLevels: ['debug'],
      term: 'certificate',
      limit: 100,
    })
  })

  test('a late file read does not replace the file chosen after it', async () => {
    const slow = deferred()
    const fast = deferred()

    api.logRead.mockImplementation(name => (name === 'slow.log' ? slow.promise : fast.promise))

    const first = store.set(logs.selectLogAtom, 'slow.log')
    const second = store.set(logs.selectLogAtom, 'fast.log')

    fast.resolve(answer('fast.log', 0, 20, {size: 20, range: {from: 0, to: 20}, entries: [{message: 'fast'}]}))
    await second

    slow.resolve(answer('slow.log', 0, 30, {size: 30, range: {from: 0, to: 30}, entries: [{message: 'slow'}]}))
    await first

    const state = store.get(logs.logsAtom)

    expect(state.file).toBe('fast.log')
    expect(state.entries).toEqual([{message: 'fast'}])
    expect(state.size).toBe(20)
    expect(state.loading).toBe(false)
  })

  test('a late range read does not replace the range chosen after it', async () => {
    await store.set(logs.loadLogsAtom)

    const reads = []
    api.logRead.mockImplementation((name, options) => {
      const pending = deferred()

      reads.push({options, pending})

      return pending.promise
    })

    const first = store.set(logs.setLogRangeAtom, {since: '2026-01-01 00:00:00', until: ''})
    const second = store.set(logs.setLogRangeAtom, {since: '2026-02-01 00:00:00', until: ''})

    reads[1].pending.resolve(answer('laravel.log', 100, 10, {
      range: {from: 100, to: 200},
      entries: [{message: 'new'}],
    }))
    await second

    reads[0].pending.resolve(answer('laravel.log', 0, 10, {
      range: {from: 0, to: 100},
      entries: [{message: 'old'}],
    }))
    await first

    const state = store.get(logs.logsAtom)

    expect(store.get(logs.logsSinceAtom)).toBe('2026-02-01 00:00:00')
    expect(state.from).toBe(100)
    expect(state.entries).toEqual([{message: 'new'}])
  })

  test('a paging answer that lands after a replacement does not change the list', async () => {
    await store.set(logs.loadLogsAtom)

    const page = deferred()
    const refresh = deferred()

    api.logRead
      .mockImplementationOnce(() => page.promise)
      .mockImplementationOnce(() => refresh.promise)

    const paging = store.set(logs.olderLogAtom)
    const replacement = store.set(logs.readLogAtom)

    const during = store.get(logs.logsAtom)

    expect(during.loading).toBe(true)
    expect(during.loadingOlder).toBe(false)

    page.resolve(answer('laravel.log', 3 * logs.defaultBytes, logs.defaultBytes))
    await paging

    const afterPage = store.get(logs.logsAtom)

    expect(afterPage.loading).toBe(true)
    expect(afterPage.loadingOlder).toBe(false)
    expect(afterPage.pages).toHaveLength(1)

    refresh.resolve(answer('laravel.log', 5 * logs.defaultBytes, logs.defaultBytes))
    await replacement

    const final = store.get(logs.logsAtom)

    expect(final.loading).toBe(false)
    expect(final.pages).toHaveLength(1)
    expect(final.from).toBe(5 * logs.defaultBytes)
  })

  test('a stale paging error does not clear a replacement that is loading', async () => {
    await store.set(logs.loadLogsAtom)

    const page = deferred()
    const refresh = deferred()

    api.logRead
      .mockImplementationOnce(() => page.promise)
      .mockImplementationOnce(() => refresh.promise)

    const paging = store.set(logs.olderLogAtom)
    const replacement = store.set(logs.readLogAtom)

    page.reject(new Error('the old page broke'))
    await paging

    const during = store.get(logs.logsAtom)

    expect(during.error).toBe('')
    expect(during.loading).toBe(true)
    expect(during.loadingOlder).toBe(false)

    refresh.resolve(answer('laravel.log', 5 * logs.defaultBytes, logs.defaultBytes))
    await replacement

    expect(store.get(logs.logsAtom).error).toBe('')
    expect(store.get(logs.logsAtom).loading).toBe(false)
  })

  test('a stale success does not clear the error of the read chosen after it', async () => {
    await store.set(logs.loadLogsAtom)

    const slow = deferred()
    const broken = deferred()

    api.logRead
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => broken.promise)

    const first = store.set(logs.readLogAtom)
    const second = store.set(logs.readLogAtom)

    broken.reject(new Error('the newer read broke'))
    await second

    expect(store.get(logs.logsAtom).error).toBe('the newer read broke')

    slow.resolve(answer('laravel.log', 3 * logs.defaultBytes, logs.defaultBytes))
    await first

    const state = store.get(logs.logsAtom)

    expect(state.error).toBe('the newer read broke')
    expect(state.loading).toBe(false)
    expect(state.pages).toHaveLength(1)
    expect(state.from).toBe(5 * logs.defaultBytes)
  })

  test('a listing that lands after a choice does not choose for the reader', async () => {
    const listing = deferred()
    const reading = deferred()

    api.logFiles.mockImplementationOnce(() => listing.promise)
    api.logRead.mockImplementationOnce(() => reading.promise)

    const loading = store.set(logs.loadLogsAtom)
    const choosing = store.set(logs.selectLogAtom, 'chosen.log')

    listing.resolve({dir: '/app/storage/logs', files: [{name: 'laravel.log', size: total, at: 1}]})
    await loading

    const during = store.get(logs.logsAtom)

    expect(during.file).toBe('chosen.log')
    expect(during.loading).toBe(true)

    reading.resolve(answer('chosen.log', 0, 10))
    await choosing

    const final = store.get(logs.logsAtom)

    expect(final.file).toBe('chosen.log')
    expect(final.loading).toBe(false)
  })

  test('paging is single-flight and a replacement owns the busy flags', async () => {
    await store.set(logs.loadLogsAtom)
    api.logRead.mockClear()

    const page = deferred()
    const refresh = deferred()

    api.logRead
      .mockImplementationOnce(() => page.promise)
      .mockImplementationOnce(() => refresh.promise)

    const paging = store.set(logs.olderLogAtom)
    const again = store.set(logs.olderLogAtom)
    const opposite = store.set(logs.newerLogAtom)

    // one page in flight, and the opposite direction waits for it
    expect(api.logRead).toHaveBeenCalledTimes(1)

    const olderState = store.get(logs.logsAtom)

    expect(olderState.loadingOlder).toBe(true)
    expect(olderState.loadingNewer).toBe(false)

    const replacement = store.set(logs.readLogAtom)

    const replacing = store.get(logs.logsAtom)

    expect(replacing.loading).toBe(true)
    expect(replacing.loadingOlder).toBe(false)
    expect(replacing.loadingNewer).toBe(false)

    page.resolve(answer('laravel.log', 3 * logs.defaultBytes, logs.defaultBytes))
    await paging
    await again
    await opposite
    await store.set(logs.followLogAtom)

    expect(store.get(logs.logsAtom).loading).toBe(true)
    expect(api.logRead).toHaveBeenCalledTimes(2)

    refresh.resolve(answer('laravel.log', 5 * logs.defaultBytes, logs.defaultBytes))
    await replacement

    expect(store.get(logs.logsAtom).loading).toBe(false)
  })

  test('a connection reset drops a read that was in flight', async () => {
    store.set(logs.logsAtom, Object.assign(logs.emptyLogs(), {file: 'laravel.log'}))

    const reading = deferred()

    api.logRead.mockImplementationOnce(() => reading.promise)

    const pending = store.set(logs.readLogAtom)

    store.set(logs.logsAtom, logs.emptyLogs())

    reading.resolve(answer('laravel.log', 5 * logs.defaultBytes, logs.defaultBytes))
    await pending

    expect(store.get(logs.logsAtom)).toEqual(logs.emptyLogs())
  })

  test('an empty range keeps the region it covered, so both ends terminate', async () => {
    store.set(logs.logsAtom, Object.assign(logs.emptyLogs(), {file: 'laravel.log'}))

    api.logRead.mockResolvedValueOnce({
      file: 'laravel.log',
      size: total,
      from: 4096,
      read: 0,
      range: {from: 4096, to: 4096},
      entries: [],
    })

    await store.set(logs.readLogAtom)

    const state = store.get(logs.logsAtom)

    expect(state.from).toBe(4096)
    expect(state.read).toBe(0)
    expect(state.pages).toEqual([])
    expect(logs.atStart(state)).toBe(true)
    expect(logs.atEnd(state)).toBe(true)
  })

  test('revision moves on a replacement, not on a page', async () => {
    await store.set(logs.loadLogsAtom)

    const loaded = store.get(logs.logsAtom).revision

    expect(loaded).toBeGreaterThan(0)

    await store.set(logs.olderLogAtom)

    expect(store.get(logs.logsAtom).revision).toBe(loaded)

    await store.set(logs.readLogAtom)

    const replaced = store.get(logs.logsAtom).revision

    expect(replaced).toBeGreaterThan(loaded)

    await store.set(logs.newerLogAtom, {force: true})

    expect(store.get(logs.logsAtom).revision).toBe(replaced)
  })

  test('cancelling a pending edge keeps the held window when its late page arrives', async () => {
    await store.set(logs.loadLogsAtom)

    for (let page = 0; page < 3; page++) {
      await store.set(logs.olderLogAtom)
    }

    const held = store.get(logs.logsAtom)
    const pending = deferred()
    api.logRead.mockReturnValueOnce(pending.promise)
    const reading = store.set(logs.olderLogAtom)

    store.set(logs.cancelLogPageAtom)
    pending.resolve(answer(held.file, held.from - logs.defaultBytes, logs.defaultBytes))
    await reading

    const state = store.get(logs.logsAtom)
    expect(state.pages).toEqual(held.pages)
    expect(state.entries).toEqual(held.entries)
    expect(state.revision).toBe(held.revision)
    expect(state.loadingOlder).toBe(false)
    expect(state.loadingNewer).toBe(false)
  })

  test('there is nothing to read before a file is open', async () => {
    await store.set(logs.olderLogAtom)
    await store.set(logs.newerLogAtom)
    await store.set(logs.followLogAtom)

    expect(api.logRead).not.toHaveBeenCalled()
    expect(store.get(logs.logsAtom)).toEqual(logs.emptyLogs())
  })
})
