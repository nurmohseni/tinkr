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

/** Whether the window holds the end of the file, the only place following means anything. */
const atEnd = logs => logs.from + logs.read >= logs.size

/** Whether the window holds the start of it, so there is nothing older to read. */
const atStart = logs => logs.from === 0

const emptyLogs = () => ({
  dir: '',
  files: [],
  file: '',
  entries: [],
  size: 0,
  read: 0,
  from: 0,
  loading: false,
  error: '',
})

const logsAtom = atom(emptyLogs())

/** What the entries are filtered by, and how closely the file is followed. */
const logsLevelAtom = atom('all')
const logsSearchAtom = atom('')
const logsFollowAtom = atom(false)
const logsIntervalAtom = atom(2000)

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

  try {
    const answer = await logRead(file, options)

    set(logsAtom, current => Object.assign({}, current, answer, {error: '', loading: false}))

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
  logsSearchAtom,
  logsFollowAtom,
  logsIntervalAtom,
  readLogAtom,
  olderLogAtom,
  newerLogAtom,
  selectLogAtom,
  loadLogsAtom,
}
