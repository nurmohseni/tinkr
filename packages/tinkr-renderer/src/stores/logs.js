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
 * tail out. The pages are contiguous byte windows, and the entry lists are
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
})

const logsAtom = atom(emptyLogs())

/** What the entries are filtered by, and how closely the file is followed. */
const logsLevelAtom = atom('all')

/**
 * The levels worth reading, as the filter's own set: empty means every level,
 * which is what a filter never touched means, so an empty set and a full one are
 * the same thing said two ways and are kept as one.
 */
const logsLevelsAtom = atom([])

/**
 * Whether a level survives the filter's set.
 *
 * The set holds the levels that were left out, so an empty one leaves nothing
 * out and a level survives unless it is named. See LogsFilter's `on`, which is
 * the same reading of the same set on the other side.
 */
const passesLevel = (levels, level) => levels.length === 0 || !levels.includes(level)
const logsSearchAtom = atom('')
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
    from: first ? first.from : 0,
    read: first && last ? (last.from + last.read) - first.from : 0,
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
 * Read the end of the open file, replacing what is held.
 *
 * This is the read an open, a refresh, a range and a follow make: the newest
 * page is what those are about, and what was held behind it was the reader's
 * history rather than the thing being asked for.
 *
 * @param {Object} [options] `bytes` for how wide the page is, or the service's
 *   own default, and `before` for where it ends, or the end of the file
 */
const readLogAtom = atom(null, async (get, set, options = {}) => {
  const {file} = get(logsAtom)

  if (!file) {
    return
  }

  set(logsAtom, current => Object.assign({}, current, {loading: true}))

  // the range is part of every read, not a filter applied to what came back:
  // a page inside a range stays inside it
  const since = get(logsSinceAtom)
  const until = get(logsUntilAtom)

  try {
    const answer = await logRead(file, Object.assign({bytes: defaultBytes}, options, {since, until}))

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
    set(logsAtom, current => Object.assign({}, current, {
      error: e.message,
      loading: false,
      loadingOlder: false,
      loadingNewer: false,
    }))
  }
})

/**
 * Read the page before the first one held, and keep it above what is held.
 *
 * The pages are contiguous byte windows: this one ends where the held window
 * starts, so the entries join without a gap.
 */
const olderLogAtom = atom(null, async (get, set) => {
  const state = get(logsAtom)

  if (!state.file || atStart(state) || state.loadingOlder || state.loadingNewer) {
    return
  }

  set(logsAtom, current => Object.assign({}, current, {loadingOlder: true}))

  const since = get(logsSinceAtom)
  const until = get(logsUntilAtom)

  try {
    const answer = await logRead(state.file, {bytes: defaultBytes, before: state.from, since, until})

    // a page that made no progress is the start, whatever the offsets say
    if (answer.read === 0 || answer.from >= state.from) {
      set(logsAtom, current => Object.assign({}, current, {
        size: answer.size,
        range: answer.range || current.range,
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
    set(logsAtom, current => Object.assign({}, current, {error: e.message, loadingOlder: false}))
  }
})

/**
 * Read the page after the last one held, and keep it below what is held.
 *
 * The read starts at the byte the loaded window ends at. A window that starts
 * mid-line drops that fragment, as every window does, so a page never repeats
 * the entry above it.
 *
 * @param {Object} [options] `force` reads even when the held pages say they are
 *   at the end, which is what following needs after the file grew
 */
const newerLogAtom = atom(null, async (get, set, options = {}) => {
  const state = get(logsAtom)

  if (!state.file || state.loadingNewer || state.loadingOlder || (!options.force && atEnd(state))) {
    return
  }

  set(logsAtom, current => Object.assign({}, current, {loadingNewer: true}))

  const since = get(logsSinceAtom)
  const until = get(logsUntilAtom)
  const end = state.from + state.read

  try {
    const answer = await logRead(state.file, {bytes: defaultBytes, after: end, since, until})
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
          loadingNewer: false,
        })
      })

      return
    }

    const pages = bounded([...state.pages, answer], 'newer')

    set(logsAtom, current => asState(pages, Object.assign({}, current, updated, {
      loadingNewer: false,
      error: '',
    })))
  } catch (e) {
    set(logsAtom, current => Object.assign({}, current, {error: e.message, loadingNewer: false}))
  }
})

/**
 * Follow the end of the file: read after the loaded window, and keep the pages
 * the reader already has.
 *
 * A file that did not grow answers with nothing, and a file that was replaced is
 * read again from its end. Following is not a refresh of the viewer.
 */
const followLogAtom = atom(null, async (get, set) => {
  const state = get(logsAtom)

  if (!state.file) {
    return
  }

  if (!atEnd(state) || state.loadingOlder || state.loadingNewer) {
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
    entries: [],
    pages: [],
    from: 0,
    read: 0,
    size: 0,
    error: '',
  }))

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
  set(logsAtom, current => Object.assign({}, current, {loading: true}))

  try {
    const {dir, files} = await logFiles()
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
    set(logsAtom, current => Object.assign({}, current, {files: [], file: '', error: e.message, loading: false}))
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
  logsLevelAtom,
  logsLevelsAtom,
  passesLevel,
  logsSearchAtom,
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
