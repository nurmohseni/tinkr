import {useEffect} from 'react'
import PropTypes from 'prop-types'
import {useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import SettingButton from './editor/SettingButton'
import LogsButton from './editor/LogsButton'
import appVersion from '../utils/appVersion'
import {
  windowStateAtom,
  followWindowStateAtom,
  minimizeAtom,
  maximizeAtom,
  closeWindowAtom,
} from '../stores/window'

/**
 * The window's own titlebar: the brand, the connection, and the controls.
 *
 * The window is frameless — the platform's frame would be a second titlebar
 * above this one, and on Windows a menu bar a third — so this strip is also the
 * window's drag region (`-webkit-app-region: drag` in the CSS, with every
 * control inside it marked `no-drag`).
 *
 * On macOS the traffic lights are the platform's, inset into this strip by the
 * main process, so the controls here are not drawn: two ways to close one window
 * is worse than either. Elsewhere they are the app's own, because that is where
 * they can be styled like everything else.
 */
const Titlebar = ({children, settings = true, logs = true}) => {
  const intl = useIntl()
  const {controls, maximized} = useAtomValue(windowStateAtom)
  const follow = useSetAtom(followWindowStateAtom)
  const minimize = useSetAtom(minimizeAtom)
  const maximize = useSetAtom(maximizeAtom)
  const close = useSetAtom(closeWindowAtom)

  useEffect(() => {
    let listener = null

    follow().then(found => {
      listener = found
    })

    return () => {
      if (listener) {
        listener.dispose()
      }
    }
  }, [])

  return (
    <header className='titlebar'>
      <div className='titlebar__side'>
        <span className='brand' title={`Tinkr ${appVersion}`}>
          {/* the mark is the signature itself: two bare bars, ink over verdigris,
              the lower one where the value lands — no tile behind them */}
          <svg width='16' height='16' viewBox='0 0 16 16' aria-hidden='true'>
            <path d='M4.6 4.5H14L12.6 7H3.2Z' fill='var(--text)'/>
            <path d='M3.4 9H12.8L11.4 11.5H2Z' fill='var(--accent)'/>
          </svg>
          <span className='brand__word'>Tinkr</span>
        </span>
      </div>

      <div className='titlebar__center'>{children}</div>

      <div className='titlebar__side titlebar__side--end'>
        {/* the settings window wears this titlebar too, and a settings button in
            it would open settings from settings. The logs button is the same:
            the logs window is not a place to open the log viewer from */}
        {logs && <LogsButton/>}
        {settings && <SettingButton/>}

        {controls && (
          <div className='titlebar__controls'>
            <button
              className='winctl'
              type='button'
              title={intl.formatMessage({id: 'window.minimize'})}
              aria-label={intl.formatMessage({id: 'window.minimize'})}
              onClick={minimize}
            >
              <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'>
                <path d='M2.5 5h5' stroke='currentColor' strokeWidth='1' strokeLinecap='round'/>
              </svg>
            </button>

            <button
              className='winctl'
              type='button'
              title={intl.formatMessage({id: maximized ? 'window.restore' : 'window.maximize'})}
              aria-label={intl.formatMessage({id: maximized ? 'window.restore' : 'window.maximize'})}
              onClick={maximize}
            >
              {maximized ? (
                /* restore: two frames, the front one smaller */
                <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true' fill='none' stroke='currentColor' strokeWidth='1'>
                  <rect x='2' y='3.4' width='4.6' height='4.6' rx='0.6'/>
                  <path d='M3.6 3.4V2.4a0.6 0.6 0 010.6-0.6h3.4a0.6 0.6 0 01.6 0.6v3.4a0.6 0.6 0 01-0.6 0.6h-1'/>
                </svg>
              ) : (
                <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true' fill='none' stroke='currentColor' strokeWidth='1'>
                  <rect x='2.2' y='2.2' width='5.6' height='5.6' rx='0.6'/>
                </svg>
              )}
            </button>

            <button
              className='winctl winctl--close'
              type='button'
              title={intl.formatMessage({id: 'window.close'})}
              aria-label={intl.formatMessage({id: 'window.close'})}
              onClick={close}
            >
              <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'>
                <path d='M2.6 2.6l4.8 4.8M7.4 2.6L2.6 7.4' stroke='currentColor' strokeWidth='1' strokeLinecap='round'/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

Titlebar.propTypes = {
  children: PropTypes.node,
  // whether the row offers settings: the settings window does not
  settings: PropTypes.bool,
  // whether the row offers the log viewer: the logs window does not
  logs: PropTypes.bool,
}

export default Titlebar
