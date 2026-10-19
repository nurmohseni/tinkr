import {useMemo, useEffect, useRef, useCallback} from 'react'
import {useAtom, useAtomValue, useSetAtom} from 'jotai'
import * as xterm from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import debounce from 'lodash/debounce'

import {termOptions, watchTermTheme} from '../../utils/getTermOptions'
import {currentResultAtom, currentOutputAtom, currentRunCodeAtom, outputViewAtom, runAtom, activeDocumentAtom} from '../../stores/editor'
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
  const output = useAtomValue(currentOutputAtom)
  const result = useAtomValue(currentResultAtom)
  const [view, setView] = useAtom(outputViewAtom)
  const run = useSetAtom(runAtom)
  const runningFor = useAtomValue(activeDocumentAtom)
  const code = useAtomValue(currentRunCodeAtom)

  // keeping a dry run means running it again, and what it runs is the code the
  // run it is offered under was sent with, not whatever the editor holds now
  // the run kept is the document's the pane is on: the same tab, sent again with
  // its transaction kept
  const keepRun = useCallback(() => run(code, {guard: 'commit', document: runningFor}), [run, code, runningFor])

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
    const options = termOptions()

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

    // the mono face lands after that first fit, and a different face is a
    // different cell width, so the fit is taken again once the fonts are in
    document.fonts.ready.then(() => fitAddonRef.current.fit())

    termRef.current = term

    return () => {
      term.dispose()
    }
  }, [])

  // the terminal paints itself, so it is pointed at the palette and at every
  // later one through the attribute the rest of the app switches with; this
  // pane takes no input, so its cursor stays the colour of its paper
  useEffect(() => watchTermTheme(termRef.current, hideCursor), [])

  return useMemo(() => (
    <>
      <div
        ref={domRef}
        style={{height: 'inherit', ...paneStyle(!result)}}
      />
      {result && (
        <Result
          result={result}
          view={view}
          onView={setView}
          onKeep={keepRun}
          allStatements={config.result_blocks !== 'last'}
        />
      )}
    </>
    // the reading is a prop of the result: a memo that ignored it would keep
    // drawing the one it was first given
  ), [result, view, config.result_blocks, keepRun])
}

export default Output
