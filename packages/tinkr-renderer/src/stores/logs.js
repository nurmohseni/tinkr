import {atom} from 'jotai'

import {logFiles, logRead} from '../utils/api'

/**
 * The log viewer: which of the connection's log files is open, the pages of it
 * that are in memory, and the filters over them.
 *
 * A log is read a page at a time and a bounded number of pages is held, so the
 * viewer costs the same for a forty-megabyte file as for a hundred-kilobyte one.
 * The list opens at the end and loads older pages as the reader scrolls up; it
 * loads newer pages again if they scrolled down after older ones had pushed the
 * tail out. The pages are entry-aligned byte windows, and the entry lists are
 * concatenated, so the reader sees one list, not a page at a time.
 *
 * Everything here is about the connection the window is on, so a window that
 * switches connection starts again — see stores/connections.js — and the panel
 * loads the new connection's files the moment it has none.
 */

// A page is read at 32 KB: enough to fill the pane on a normal log, small enough
// that the next page arrives while a scroll is still settling. The hard caps are
// what keep a file with very short lines from becoming a DOM the size of the
// file; a page alone may be larger, and one page is always kept.
const defaultBytes = 32 * 1024
const maxPages = 4
const maxEntries = 3000

// How many matching entries a filtered read asks for. The page is still read
// whole on the host, so this bounds the answer rather than the bytes scanned.
const pageLimit = 100

// A replacement is owned by the request that started it. The token is an
// identity rather than a counter so a connection reset — which replaces the
// state with a fresh empty one — invalidates whatever was still in flight.
const newRequest = () => ({})

/**
 * Whether the loaded pages reach the end of what they were read inside — the
 * range, or the whole file — which is the only place following means anything.
 */
const atEnd = logs => logs.from + logs.read >= (logs.range ? logs.range.to : logs.size)

/** Whether the pages reach the start of that, so there is nothing older. */
const atStart = logs => logs.from <= (logs.range ? logs.range.from : 0)

const emptyLogs = () => ({
  dir: '',
  files: [],
  file: '',
  // contiguous pages, oldest first: {file, size, read, from, range, entries}
  pages: [],
  entries: [],
  size: 0,
  read: 0,
  from: 0,
  // the range the pages were read inside, which is where paging stops: with no
  // range it is the whole file
  range: {from: 0, to: 0},
  loading: false,
  loadingOlder: false,
  loadingNewer: false,
  error: '',
  // the replacement read that owns this state, and a revision the panel anchors
  // its scroll and its pin on. Paging keeps both: it extends a replacement, it
  // does not replace one.
  request: newRequest(),
  revision: 0,
})

const logsAtom = atom(emptyLogs())

/**
 * The levels left out by the filter. An empty set shows every level; a full set
 * excludes every known level while retaining unformatted text.
 *
 * The set is held in a base atom because changing it is a query change: the
 * exported `logsLevelsAtom` below writes it and reads the file again.
 */
const logsLevelsBaseAtom = atom([])

const logsSearchBaseAtom = atom('')
const logsFollowAtom = atom(false)
const logsIntervalAtom = atom(2000)

// The moment the reader is filtering from and to, as the file stamps them:
// `2026-08-27 11:10:52`. Empty is open-ended, which is what a filter that was
// never set is. The range is applied by the service, not by the panel: it is
// found in the file, so it reaches entries no page in memory holds.
const logsSinceAtom = atom('')
const logsUntilAtom = atom('')

/** Whether a range is narrowing what is shown. */
const logsRangedAtom = atom(get => get(logsSinceAtom) !== '' || get(logsUntilAtom) !== '')

/**
 * The entries of the pages, and where the pages sit as one window.
 *
 * The list is flattened once per page change rather than in the render: every
 * entry of every page is already an object, and the only new thing the render
 * needs is the array that holds them in order.
 *
 * @param {Array<Object>} pages
 * @param {Object} base the rest of the state
 * @return {Object}
 */
const asState = (pages, base) => {
  const first = pages[0]
  const last = pages[pages.length - 1]

  return Object.assign({}, base, {
    pages,
    entries: pages.flatMap(page => page.entries),
    // a replacement that found no entries still covers a byte region: keeping
    // its offsets is what lets both ends of an empty range terminate instead of
    // pretending the window fell back to the start of the file
    from: first ? first.from : (base.from || 0),
    read: first && last ? (last.from + last.read) - first.from : (base.read || 0),
  })
}

/**
 * Drop pages from the far side of what the reader is reading until the caps hold.
 *
 * Loading older pages drops the newest ones, and loading newer pages drops the
 * oldest: the window follows the reader, and the side that went is reloaded if
 * they come back to it. One page is always kept, even when it alone is over the
 * entry cap, because dropping it would be an empty viewer on a file that has
 * entries.
 *
 * @param {Array<Object>} pages
 * @param {'older'|'newer'} side which end just grew
 * @return {Array<Object>}
 */
const bounded = (pages, side) => {
  let next = pages
  const count = list => list.reduce((total, page) => total + page.entries.length, 0)

  while (next.length > 1 && (next.length > maxPages || count(next) > maxEntries)) {
    next = side === 'older' ? next.slice(0, -1) : next.slice(1)
  }

  return next
}

/**
 * What a viewer read asks the service for.
 *
 * The viewer reads whole entries from the whole file: the host finds the page
 * boundaries and applies the level set and the term, so a match behind the
 * bytes already read is still found. `excludeLevels` is the filter's set of
 * left-out levels and `term` its search; empty values mean no filter.
 *
 * @param {Function} get
 * @param {Object} [options] `before` or `after` for the side of the window
 * @return {Object}
 */
const viewerRead = (get, options = {}) => Object.assign(
  {bytes: defaultBytes},
  options,
  {
    paginate: true,
    excludeLevels: get(logsLevelsBaseAtom),
    term: get(logsSearchBaseAtom),
    limit: pageLimit,
    since: get(logsSinceAtom),
    until: get(logsUntilAtom),
  },
)

/**
 * Read the end of the open file, replacing what is held.
 *
 * This is the read an open, a refresh, a range and a follow make: the newest
 * page is what those are about, and what was held behind it was the reader's
 * history rather than the thing being asked for.
 *
 * The read owns the state it started in. A read that lands after any newer
 * replacement — another file, another range, a filter, a reset — is dropped
 * whole: neither its entries nor its error may touch what the reader asked for
 * last.
 *
 * @param {Object} [options] `bytes` for how wide the page is, or the service's
 *   own default, and `before` for where it ends, or the end of the file
 */
const readLogAtom = atom(null, async (get, set, options = {}) => {
  const {file} = get(logsAtom)

  if (!file) {
    return
  }

  const request = newRequest()

  set(logsAtom, current => Object.assign({}, current, {
    request,
    revision: (current.revision || 0) + 1,
    loading: true,
    // paging belongs to the replacement that is being replaced; its answer is
    // stale, so its busy flags go with it
    loadingOlder: false,
    loadingNewer: false,
    error: '',
  }))

  try {
    const answer = await logRead(file, viewerRead(get, options))

    if (get(logsAtom).request !== request) {
      return
    }

    // a window that names no range was read inside the whole file, which is what
    // paging then stops at
    const range = answer.range || {from: 0, to: answer.size}

    set(logsAtom, current => asState(answer.read > 0 ? [answer] : [], Object.assign(
      {},
      current,
      answer,
      {range, error: '', loading: false, loadingOlder: false, loadingNewer: false},
    )))

    // following watches the end of the file, so a window that has left it is not
    // one being followed any more — the switch says so rather than the reader
    // being pulled back to the tail
    if (!atEnd(answer)) {
      set(logsFollowAtom, false)
    }
  } catch (e) {
    if (get(logsAtom).request !== request) {
      return
    }

    set(logsAtom, current => Object.assign({}, current, {
      error: e.message,
      loading: false,
      loadingOlder: false,
      loadingNewer: false,
    }))
  }
})

/**
 * The levels worth reading, as the filter's own set. Writing it is a query
 * change, and a query change is a replacement read: the service finds the
 * matches over the whole file rather than the panel hiding entries it already
 * has.
 */
const logsLevelsAtom = atom(
  get => get(logsLevelsBaseAtom),
  (get, set, levels) => {
    set(logsLevelsBaseAtom, levels || [])
    return set(readLogAtom)
  },
)

/**
 * The term the file is searched for. Writing it is a query change like the level
 * set; the panel debounces the field so typing does not become one read per
 * keystroke.
 */
const logsSearchAtom = atom(
  get => get(logsSearchBaseAtom),
  (get, set, term) => {
    set(logsSearchBaseAtom, term || '')
    return set(readLogAtom)
  },
)

// Leaving a pending edge cancels its ownership, not the held window. The host
// may finish reading, but its answer must not evict the page now under the eye.
const cancelLogPageAtom = atom(null, (get, set) => {
  const state = get(logsAtom)

  if (state.loading || (!state.loadingOlder && !state.loadingNewer)) {
    return
  }

  set(logsAtom, Object.assign({}, state, {
    request: newRequest(),
    loadingOlder: false,
    loadingNewer: false,
  }))
})

/**
 * Read the page before the first one held, and keep it above what is held.
 *
 * The pages are contiguous byte windows: this one ends where the held window
 * starts, so the entries join without a gap.
 */
const olderLogAtom = atom(null, async (get, set) => {
  const state = get(logsAtom)

  if (
    !state.file ||
    state.loading ||
    atStart(state) ||
    state.loadingOlder ||
    state.loadingNewer
  ) {
    return
  }

  const {request} = state

  set(logsAtom, current => Object.assign({}, current, {
    loadingOlder: true,
    error: '',
  }))

  try {
    const answer = await logRead(state.file, viewerRead(get, {before: state.from}))

    // a replacement that started while this page was being read owns the list
    // now: this answer is not a page of it, and it must not clear its flags
    if (get(logsAtom).request !== request) {
      return
    }

    // a page that made no progress is the start, whatever the offsets say
    if (answer.read === 0 || answer.from >= state.from) {
      set(logsAtom, current => Object.assign({}, current, {
        size: answer.size,
        range: answer.range || current.range,
        // an empty page has no first entry to carry the window, so its covered
        // region is the only thing that can move it to the start
        from: current.pages.length === 0 ? answer.from : current.from,
        read: current.pages.length === 0 ? answer.read : current.read,
        loadingOlder: false,
      }))

      return
    }

    const pages = bounded([answer, ...state.pages], 'older')
    const range = answer.range || state.range
    const merged = asState(pages, Object.assign({}, state, {size: answer.size, range}))

    set(logsAtom, current => asState(pages, Object.assign({}, current, {
      size: answer.size,
      range,
      error: '',
      loadingOlder: false,
    })))

    if (!atEnd(merged)) {
      set(logsFollowAtom, false)
    }
  } catch (e) {
    if (get(logsAtom).request !== request) {
      return
    }

    set(logsAtom, current => Object.assign({}, current, {error: e.message, loadingOlder: false}))
  }
})

/**
 * Read the page after the last one held, and keep it below what is held.
 *
 * The read starts at the byte the loaded window ends at. Normally the page
 * begins there; when the file grew inside the entry the window ends in, an
 * unfiltered read aligns the answer back to that entry's start and returns it
 * whole, so the held truncated copy is dropped rather than the entry being
 * shown twice. A filtered read does not repeat a held entry: it starts at the
 * first complete matching entry after the cursor, which may be past the held
 * end. A blank line between entries is skipped the same way.
 *
 * @param {Object} [options] `force` reads even when the held pages say they are
 *   at the end, which is what following needs after the file grew
 */
const newerLogAtom = atom(null, async (get, set, options = {}) => {
  const state = get(logsAtom)

  if (
    !state.file ||
    state.loading ||
    state.loadingNewer ||
    state.loadingOlder ||
    (!options.force && atEnd(state))
  ) {
    return
  }

  const {request} = state
  const end = state.from + state.read
  // filtered forward pages snap to the first complete matching entry, so they
  // never repeat a held entry; an unfiltered one can begin inside the entry the
  // window ends in and has to be joined in its place
  const term = get(logsSearchBaseAtom) || ''
  const filtered = get(logsLevelsBaseAtom).length > 0 || String(term).trim() !== ''

  set(logsAtom, current => Object.assign({}, current, {
    loadingNewer: true,
    error: '',
  }))

  try {
    const answer = await logRead(state.file, viewerRead(get, {after: end}))

    if (get(logsAtom).request !== request) {
      return
    }

    const range = answer.range || state.range
    const updated = Object.assign({}, state, {size: answer.size, range})

    // a file replaced under the reader is shorter than what is held: the new end
    // is a new file rather than a page after this one
    if (end > answer.size) {
      await set(readLogAtom)

      return
    }

    if (answer.read === 0) {
      // the file may have grown by a partial line, or been replaced; the answer
      // is where it now ends, even when there is nothing more to join. A file
      // that did not move is not a reason to redraw the list.
      set(logsAtom, current => {
        const same = current.size === answer.size &&
          current.range && current.range.from === range.from && current.range.to === range.to

        if (same && !current.loadingNewer) {
          return current
        }

        return Object.assign({}, current, {
          size: answer.size,
          range,
          // with no page to carry the window, the answer's covered region is
          // what moves it; otherwise the fragment after the end is left where
          // it is and read again when more of it arrives
          from: current.pages.length === 0 ? answer.from : current.from,
          read: current.pages.length === 0 ? answer.read : current.read,
          loadingNewer: false,
        })
      })

      return
    }

    // A page that starts before the held end repeats the entry the old window
    // ended inside: the state held it as it was then, and the answer has it
    // whole now. Cut the old tail at the repeated entry and join the whole one,
    // rather than showing the entry twice or leaving its truncated version in
    // front of the rest of it.
    const pages = [...state.pages]
    const last = pages[pages.length - 1]

    // An answer must not start before the window it extends: that is an older
    // region this state cannot cut without rebuilding. Starting after the held
    // end is not a gap to repair — a blank line between entries, or a filtered
    // page whose first match comes later, is joined as its own page.
    if (answer.from < state.from) {
      await set(readLogAtom)

      return
    }

    // A completed tail can change whether it matches. Rebuild a filtered
    // overlap because the old tail may have been absent from the held entries.
    if (filtered && answer.from < end) {
      await set(readLogAtom)

      return
    }

    if (answer.from < end && last) {
      // an overlap that reaches back past the page it belongs to would have to
      // trim more than the last page
      if (answer.from < last.from) {
        await set(readLogAtom)

        return
      }

      const trimmed = answer.from - last.from

      if (trimmed === 0) {
        pages.pop()
      } else {
        pages[pages.length - 1] = Object.assign({}, last, {
          read: trimmed,
          entries: last.entries.slice(0, -1),
        })
      }
    }

    const next = bounded([...pages, answer], 'newer')

    set(logsAtom, current => asState(next, Object.assign({}, current, updated, {
      loadingNewer: false,
      error: '',
    })))
  } catch (e) {
    if (get(logsAtom).request !== request) {
      return
    }

    set(logsAtom, current => Object.assign({}, current, {error: e.message, loadingNewer: false}))
  }
})

/**
 * Follow the end of the file: read after the loaded window, and keep the pages
 * the reader already has.
 *
 * A file that did not grow answers with nothing, and a file that was replaced is
 * read again from its end. Following is not a refresh of the viewer.
 *
 * It is deliberately not gated on `atEnd`: a file can grow by a partial line,
 * which moves its size past the loaded window without giving a complete entry.
 * The next poll reads from the same byte, so the entry is joined when the rest
 * of it is written instead of the window stalling one fragment short of the end.
 * A reader who has left the tail turns following off, so this only polls while
 * the end is what they are watching.
 */
const followLogAtom = atom(null, async (get, set) => {
  const state = get(logsAtom)

  if (!state.file || state.loading || state.error || state.loadingOlder || state.loadingNewer) {
    return
  }

  await set(newerLogAtom, {force: true})
})

/**
 * Open one of them, and read its end.
 *
 * @param {String} name
 */
const selectLogAtom = atom(null, async (get, set, name) => {
  set(logsAtom, current => Object.assign({}, current, {
    file: name,
    pages: [],
    entries: [],
    from: 0,
    read: 0,
    size: 0,
    error: '',
    // the file the reader left may still have a read in flight; it is not a
    // page of the file they chose
    request: newRequest(),
    revision: name ? current.revision : (current.revision || 0) + 1,
    loading: Boolean(name),
    loadingOlder: false,
    loadingNewer: false,
  }))

  if (!name) {
    return
  }

  await set(readLogAtom)
})

/**
 * Narrow what is shown to a range of moments, and read the end of it.
 *
 * The range is what the service is asked for, so this is one read like any
 * other: the page that comes back lands at the end of the range, and the pages
 * stop at its edges rather than at the file's.
 *
 * @param {Object} range `since` and `until`, either of which may be empty
 */
const setLogRangeAtom = atom(null, async (get, set, {since, until}) => {
  set(logsSinceAtom, since || '')
  set(logsUntilAtom, until || '')

  await set(readLogAtom)
})

/** Show the whole file again, and stop following a range. */
const clearLogRangeAtom = atom(null, async (get, set) => {
  set(logsSinceAtom, '')
  set(logsUntilAtom, '')

  await set(readLogAtom)
})

/**
 * Read what the connection has, and open the newest of it unless one is open.
 */
const loadLogsAtom = atom(null, async (get, set) => {
  const request = newRequest()

  set(logsAtom, current => Object.assign({}, current, {
    request,
    revision: (current.revision || 0) + 1,
    loading: true,
    loadingOlder: false,
    loadingNewer: false,
    error: '',
  }))

  try {
    const {dir, files} = await logFiles()

    // a file chosen while the list was being read is newer than the list: the
    // listing must not put its own choice back, nor clear the read that choice
    // started
    if (get(logsAtom).request !== request) {
      return
    }

    const open = get(logsAtom).file
    const file = files.some(one => one.name === open) ? open : (files[0] || {}).name || ''

    set(logsAtom, current => Object.assign({}, current, {
      dir,
      files,
      file,
      pages: [],
      entries: [],
      from: 0,
      read: 0,
      size: 0,
      error: '',
      loading: false,
    }))

    if (file) {
      await set(readLogAtom)
    }
  } catch (e) {
    if (get(logsAtom).request !== request) {
      return
    }

    set(logsAtom, current => Object.assign({}, current, {
      files: [],
      file: '',
      error: e.message,
      loading: false,
      loadingOlder: false,
      loadingNewer: false,
    }))
  }
})

export {
  defaultBytes,
  maxPages,
  maxEntries,
  atEnd,
  atStart,
  emptyLogs,
  logsAtom,
  logsLevelsAtom,
  logsSearchAtom,
  cancelLogPageAtom,
  logsFollowAtom,
  logsIntervalAtom,
  logsSinceAtom,
  logsUntilAtom,
  logsRangedAtom,
  setLogRangeAtom,
  clearLogRangeAtom,
  readLogAtom,
  olderLogAtom,
  newerLogAtom,
  followLogAtom,
  selectLogAtom,
  loadLogsAtom,
}
