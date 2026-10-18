import {atom} from 'jotai'

import {logFiles, logRead} from '../utils/api'

/**
 * The log viewer: which of the connection's log files is open, what window of it
 * was read, and the filters over it.
 *
 * A log is read a window at a time and only one of them is ever held, so a file
 * too big to hold is read as cheaply as a small one: the window is where the
 * reader is in it, and a step back or forward moves by one.
 *
 * Everything here is about the connection the window is on, so a window that
 * switches connection starts again — see stores/connections.js — and the panel
 * loads the new connection's files the moment it has none.
 */

// The window the service reads unless it is asked for more, and what a step back
// or forward moves by. The store names it because a step is a whole window even
// where the service's own default would have been clamped by the file.
const defaultBytes = 128 * 1024

/**
 * Whether the window holds the end of what it was read inside — the range, or the
 * whole file — which is the only place following means anything.
 */
const atEnd = logs => logs.from + logs.read >= (logs.range ? logs.range.to : logs.size)

/** Whether it holds the start of that, so there is nothing older to read. */
const atStart = logs => logs.from === (logs.range ? logs.range.from : 0)

const emptyLogs = () => ({
  dir: '',
  files: [],
  file: '',
  entries: [],
  size: 0,
  read: 0,
  from: 0,
  // the range the window was read inside, which is where paging stops: with no
  // range it is the whole file
  range: {from: 0, to: 0},
  loading: false,
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

/** Whether a level survives the filter's set. */
const passesLevel = (levels, level) => levels.length === 0 || levels.includes(level)
const logsSearchAtom = atom('')
const logsFollowAtom = atom(false)
const logsIntervalAtom = atom(2000)

// The moment the reader is filtering from and to, as the file stamps them:
// `2026-08-27 11:10:52`. Empty is open-ended, which is what a filter that was
// never set is. The range is applied by the service, not by the panel: it is
// found in the file, so it reaches entries no window in memory holds.
const logsSinceAtom = atom('')
const logsUntilAtom = atom('')

/** Whether a range is narrowing what is shown. */
const logsRangedAtom = atom(get => get(logsSinceAtom) !== '' || get(logsUntilAtom) !== '')

/**
 * Read a window of the open file.
 *
 * @param {Object} [options] `bytes` for how wide the window is, or the service's
 * own default, and `before` for where it ends, or the end of the file
 */
const readLogAtom = atom(null, async (get, set, options) => {
  const {file} = get(logsAtom)

  if (!file) {
    return
  }

  set(logsAtom, current => Object.assign({}, current, {loading: true}))

  // the range is part of every read, not a filter applied to what came back:
  // a page step inside a range stays inside it
  const since = get(logsSinceAtom)
  const until = get(logsUntilAtom)

  try {
    const answer = await logRead(file, Object.assign({}, options, {since, until}))

    // a window that names no range was read inside the whole file, which is what
    // paging then stops at
    const range = answer.range || {from: 0, to: answer.size}

    set(logsAtom, current => Object.assign({}, current, answer, {range, error: '', loading: false}))

    // following watches the end of the file, so a window that has left it is not
    // one being followed any more — the switch says so rather than the reader
    // being pulled back to the tail
    if (!atEnd(answer)) {
      set(logsFollowAtom, false)
    }
  } catch (e) {
    set(logsAtom, current => Object.assign({}, current, {error: e.message, loading: false}))
  }
})

/** Read the window before the one in view, which ends where that one starts. */
const olderLogAtom = atom(null, (get, set) => {
  const state = get(logsAtom)

  if (!state.file || atStart(state)) {
    return
  }

  return set(readLogAtom, {bytes: defaultBytes, before: state.from})
})

/** Read the window after the one in view, which starts where that one ends. */
const newerLogAtom = atom(null, (get, set) => {
  const state = get(logsAtom)

  if (!state.file || atEnd(state)) {
    return
  }

  return set(readLogAtom, {bytes: defaultBytes, before: state.from + state.read + defaultBytes})
})

/**
 * Open one of them, and read its end.
 *
 * @param {String} name
 */
const selectLogAtom = atom(null, async (get, set, name) => {
  set(logsAtom, current => Object.assign({}, current, {file: name, entries: [], error: ''}))

  await set(readLogAtom)
})

/**
 * Narrow what is shown to a range of moments, and read the end of it.
 *
 * The range is what the service is asked for, so this is one read like any
 * other: the window that comes back lands at the end of the range, and the paging
 * steps stop at its edges rather than at the file's.
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

    set(logsAtom, current => Object.assign({}, current, {dir, files, file, entries: [], error: '', loading: false}))

    if (file) {
      await set(readLogAtom)
    }
  } catch (e) {
    set(logsAtom, current => Object.assign({}, current, {files: [], file: '', error: e.message, loading: false}))
  }
})

export {
  defaultBytes,
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
  selectLogAtom,
  loadLogsAtom,
}
