import {useMemo, useEffect, useRef} from 'react'
import * as xterm from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import {onOutputConnection, onRunOutput, inputConnection, onReconnectConnection} from '../../utils/api'
import {getTermOptions} from '../../utils/getTermOptions'
import {configAtom} from '../../stores/config'
import {useAtomValue, useSetAtom} from 'jotai'
import useFitAddon from '../../hooks/useFitAddon'
import {appendOutputAtom} from '../../stores/editor'

const Terminal = () => {
  const domRef = useRef()
  const termRef = useRef()
  const config = useAtomValue(configAtom)
  const {fitAddonRef} = useFitAddon()
  const appendOutput = useSetAtom(appendOutputAtom)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const term = new xterm.Terminal({
      ...getTermOptions(config.theme),
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

    return () => {
      onOutput.dispose()
      onRun.dispose()
      onReconnect.dispose()
      term.dispose()
    }
  }, [])

  // the terminal paints itself, so it has to be told about a theme change
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = getTermOptions(config.theme).theme
    }
  }, [config.theme])

  return useMemo(() => (
    <div
      style={{height: 'inherit'}}
      ref={domRef}
    />
  ), [])
}

export default Terminal
