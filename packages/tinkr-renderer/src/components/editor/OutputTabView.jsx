import {useAtomValue} from 'jotai'

import AiPanel from './AiPanel'
import Output from './Output'
import Terminal from './Terminal'
import {outputTabIndexAtom} from '../../stores/editor'

// the view that is not shown is hidden where it keeps the size it is measured
// at: a terminal that is fitted while its view is hidden has to fit the same box
const hidden = {visibility: 'hidden', position: 'absolute', zIndex: -999}

/**
 * The output panel's views: the run's output, the session's terminal, and the ai
 * panel.
 *
 * They all stay mounted, so switching tabs never restarts a terminal: the
 * terminal keeps the session's tty, the output keeps the tty it writes the run's
 * own text to, and the ai panel keeps the thread it is in the middle of. The
 * view that scrolls is the design's `.output__body` itself.
 */
const OutputTabView = () => {
  const tabIndex = useAtomValue(outputTabIndexAtom)

  return (
    <div
      className='output__body'
      style={{
        position: 'relative',
        height: '100%',
        flex: '1 1 auto',
        minHeight: 0,
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <div style={tabIndex === 0 ? {height: 'inherit'} : {height: 'inherit', ...hidden}}>
        <Terminal/>
      </div>

      <div
        className='output__body'
        style={tabIndex === 1 ? {height: 'inherit'} : {height: 'inherit', ...hidden}}
      >
        <Output/>
      </div>

      <div style={tabIndex === 2 ? {height: 'inherit'} : {height: 'inherit', ...hidden}}>
        <AiPanel/>
      </div>
    </div>
  )
}

export default OutputTabView
