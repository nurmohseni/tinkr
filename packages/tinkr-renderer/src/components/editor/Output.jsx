import {useMemo, useEffect, useRef, useCallback} from 'react'
import {useAtom, useAtomValue} from 'jotai'
import * as xterm from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import debounce from 'lodash/debounce'

import {getTermOptions} from '../../utils/getTermOptions'
import {outputAtom, outputViewAtom, resultAtom} from '../../stores/editor'
import {configAtom} from '../../stores/config'
import Result from './Result'
import useFitAddon from '../../hooks/useFitAddon'

// the output terminal takes no input, so its cursor matches the background
const hideCursor = theme => Object.assign({}, theme, {cursor: theme.background})

const paneStyle = visible => {
  if (visible) {
    return {}
  }

  return {
    visibility: 'hidden',
    position: 'absolute',
    zIndex: -999,
  }
}

/**
 * What the last run returned, or what it printed while it was running.
 *
 * The pane is fed the run's own stream (see the main process's `runOutput`), so
 * the session booting — the prompt, the connection's command, psysh's banner —
 * is never part of it, and what shows up before the result arrives is the run
 * printing as it goes.
 *
 * The terminal is kept mounted and hidden behind the result, because it is the
 * same pty the session writes to: disposing it would lose the scrollback.
 */
const Output = () => {
  const domRef = useRef()
  const termRef = useRef()
  const config = useAtomValue(configAtom)
  const {fitAddonRef} = useFitAddon()
  const output = useAtomValue(outputAtom)
  const result = useAtomValue(resultAtom)
  const [view, setView] = useAtom(outputViewAtom)

  // 清空 output，写入内容
  // https://github.com/xtermjs/xterm.js/issues/943
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const writeOutput = useCallback(debounce(output => {
    const term = termRef.current
    if (term) {
      term.reset()
      term.write(output)
    }
  }, 500), [])

  // 写入内容至 output
  useEffect(() => {
    writeOutput(output)
  }, [output])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const options = getTermOptions(config.theme)

    const term = new xterm.Terminal({
      ...options,
      fontSize: 12,
      disableStdin: true,
    })

    // 不显示 cursor
    term.options.theme = hideCursor(options.theme)

    term.open(domRef.current)
    term.loadAddon(fitAddonRef.current)
    fitAddonRef.current.fit()

    termRef.current = term

    return () => {
      term.dispose()
    }
  }, [])

  // the terminal paints itself, so it has to be told about a theme change
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = hideCursor(getTermOptions(config.theme).theme)
    }
  }, [config.theme])

  return useMemo(() => (
    <>
      <div
        ref={domRef}
        style={{height: 'inherit', ...paneStyle(!result)}}
      />
      {result && (
        <Result result={result} view={view} onView={setView}/>
      )}
    </>
    // the reading is a prop of the result: a memo that ignored it would keep
    // drawing the one it was first given
  ), [result, view])
}

export default Output
