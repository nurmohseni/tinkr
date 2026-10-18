import {atom} from 'jotai'

import {windowControl, windowState, onWindowState} from '../utils/api'

/**
 * Whether the window is maximized, and whether this platform's titlebar is the
 * app's to draw.
 *
 * The window is frameless on Windows and Linux, so the three controls are part
 * of the page there; on macOS the traffic lights are the platform's and
 * `controls` is false. The state starts at nothing and is filled from the main
 * process, which also says when the window maximizes or restores.
 *
 * @type {Object}
 */
const windowStateAtom = atom({maximized: false, controls: false})

/**
 * Ask the main process what the window is, and keep listening for the changes.
 *
 * The listener is handed back so the caller can drop it when its window goes:
 * a window that is closed twice over must not leave a listener behind.
 *
 * @return {Promise<{dispose: Function}>}
 */
const followWindowStateAtom = atom(null, async (get, set) => {
  const state = await windowState()

  set(windowStateAtom, {maximized: Boolean(state.maximized), controls: Boolean(state.controls)})

  return onWindowState(({maximized}) => {
    set(windowStateAtom, previous => ({...previous, maximized: Boolean(maximized)}))
  })
})

/**
 * The three controls: the main process acts on the window the message came
 * from, which is what makes the same controls work in either window.
 */
const minimizeAtom = atom(null, () => windowControl('minimize'))
const maximizeAtom = atom(null, () => windowControl('maximize'))
const closeWindowAtom = atom(null, () => windowControl('close'))

export {
  windowStateAtom,
  followWindowStateAtom,
  minimizeAtom,
  maximizeAtom,
  closeWindowAtom,
}
