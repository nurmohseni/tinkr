import {atom} from 'jotai'

import {logFiles, logRead} from '../utils/api'

/**
 * The log viewer: which of the connection's log files is open, what was read of
 * it, and the filters over it.
 *
 * Everything here is about the connection the window is on, so a window that
 * switches connection starts again — see stores/connections.js — and the panel
 * loads the new connection's files the moment it has none.
 */
const emptyLogs = () => ({
  dir: '',
  files: [],
  file: '',
  entries: [],
  size: 0,
  read: 0,
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
 * Read the open file again.
 *
 * @param {Number} [bytes] how much of the end of it to read, or the service's own
 * default
 */
const readLogAtom = atom(null, async (get, set, bytes) => {
  const {file} = get(logsAtom)

  if (!file) {
    return
  }

  set(logsAtom, current => Object.assign({}, current, {loading: true}))

  try {
    const answer = await logRead(file, bytes)

    set(logsAtom, current => Object.assign({}, current, answer, {error: '', loading: false}))
  } catch (e) {
    set(logsAtom, current => Object.assign({}, current, {error: e.message, loading: false}))
  }
})

/**
 * Open one of them, and read it.
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
  emptyLogs,
  logsAtom,
  logsLevelAtom,
  logsSearchAtom,
  logsFollowAtom,
  logsIntervalAtom,
  readLogAtom,
  selectLogAtom,
  loadLogsAtom,
}
