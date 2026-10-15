import {atom} from 'jotai'

import {downloadUpdate} from '../utils/api'

/**
 * A newer version, and what the window has done about it:
 *
 *   idle → available → downloading (with a percentage) → ready
 *                     ↘ failed
 *
 * Nothing moves out of `idle` on its own: a check finds a version, and the
 * window asks the user before the download and before the install.
 */
const updateStateAtom = atom({status: 'idle'})

const updateAvailableAtom = atom(null, (get, set, {version}) => {
  set(updateStateAtom, {status: 'available', version})
})

const updateNotAvailableAtom = atom(null, (get, set) => {
  set(updateStateAtom, state => (state.status === 'available' ? {status: 'idle'} : state))
})

const updateProgressAtom = atom(null, (get, set, {percent}) => {
  set(updateStateAtom, state => (state.status === 'downloading' ? {...state, percent} : state))
})

const updateDownloadedAtom = atom(null, (get, set, {version}) => {
  set(updateStateAtom, {status: 'ready', version})
})

// a check that could not be made never reaches the window: only a download the
// user asked for has a failure worth showing
const updateFailedAtom = atom(null, (get, set, {message}) => {
  set(updateStateAtom, state => (state.status === 'downloading' ? {status: 'failed', message} : state))
})

const downloadUpdateAtom = atom(null, (get, set) => {
  set(updateStateAtom, state => ({...state, status: 'downloading', percent: 0}))
  downloadUpdate()
})

const dismissUpdateAtom = atom(null, (get, set) => {
  set(updateStateAtom, {status: 'idle'})
})

export {
  updateStateAtom,
  updateAvailableAtom,
  updateNotAvailableAtom,
  updateProgressAtom,
  updateDownloadedAtom,
  updateFailedAtom,
  downloadUpdateAtom,
  dismissUpdateAtom,
}
