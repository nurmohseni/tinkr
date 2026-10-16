import {useMemo, useEffect, useRef} from 'react'
import * as xterm from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import {onOutputConnection, onRunOutput, inputConnection, onReconnectConnection} from '../../utils/api'
import {termOptions, watchTermTheme} from '../../utils/getTermOptions'
import {useSetAtom} from 'jotai'
import useFitAddon from '../../hooks/useFitAddon'
import {appendOutputAtom} from '../../stores/editor'

const Terminal = () => {
  const domRef = useRef()
  const termRef = useRef()
  const {fitAddonRef} = useFitAddon()
  const appendOutput = useSetAtom(appendOutputAtom)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const term = new xterm.Terminal({
      ...termOptions(),
      fontSize: 12,
      cursorBlink: true,
      disableStdin: false,
      convertEol: true,
    })

    termRef.current = term

    term.open(domRef.current)
    // 绑定输入
    term.onData(inputConnection)

    term.attachCustomKeyEventHandler(event => {
      // command + k 清空 terminal
      if (event.metaKey && event.key === 'k') {
        term.clear()
        return false
      }
    })

    // the terminal is the session, whole: it takes everything the pty writes
    const onOutput = onOutputConnection(data => term.write(data))

    // the output pane is the run: it takes only what the run printed, so the
    // boot of the session never reaches it
    const onRun = onRunOutput(data => appendOutput(data))

    const reset = () => {
      term.reset()
    }

    const onReconnect = onReconnectConnection(reset)

    term.loadAddon(fitAddonRef.current)
    fitAddonRef.current.fit()

    // the mono face lands after that first fit, and a different face is a
    // different cell width, so the fit is taken again once the fonts are in
    document.fonts.ready.then(() => fitAddonRef.current.fit())

    return () => {
      onOutput.dispose()
      onRun.dispose()
      onReconnect.dispose()
      term.dispose()
    }
  }, [])

  // the terminal paints itself, so it is pointed at the palette and at every
  // later one through the attribute the rest of the app switches with
  useEffect(() => watchTermTheme(termRef.current), [])

  return useMemo(() => (
    <div
      style={{height: 'inherit'}}
      ref={domRef}
    />
  ), [])
}

export default Terminal
