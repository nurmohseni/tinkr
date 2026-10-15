import {useEffect} from 'react'
import Split from 'react-split'
import {Route, useLocation} from 'wouter'
import {useAtomValue, useSetAtom} from 'jotai'
import throttle from 'lodash/throttle'

import EditorPage from './components/EditorPage'
import WindowContainer from './components/WindowContainer'
import Titlebar from './components/Titlebar'
import Statusbar from './components/Statusbar'
import Sidebar from './components/editor/Sidebar'
import Toolbar from './components/editor/Toolbar'
import OutputTabView from './components/editor/OutputTabView'
import SnippetActions from './components/editor/SnippetActions'
import DeleteSnippetConfirm from './components/editor/DeleteSnippetConfirm'
import ConnectionPage from './components/ConnectionPage'
import DeleteConnectionConfirm from './components/connections/DeleteConnectionConfirm'
import useSplit from './hooks/useSplit'
import {sizesAtom, resultAtom, connectionAtom} from './stores/editor'
import {configAtom} from './stores/config'
import {historyListAtom} from './stores/history'
import {switchConnectionAtom} from './stores/connections'
import {onRunResult, onHistoryConnection, onSetConnection} from './utils/api'

// the split handle is the design's 6px divider, not react-split's 10px default
const splitGutter = (index, direction) => {
  const gutter = document.createElement('div')

  gutter.className = `gutter gutter-${direction} split`

  return gutter
}

const EditorWindow = () => {
  const {splitRef} = useSplit()
  const setSizes = useSetAtom(sizesAtom)
  const setResult = useSetAtom(resultAtom)
  const setHistory = useSetAtom(historyListAtom)
  const connection = useAtomValue(connectionAtom)
  const config = useAtomValue(configAtom)
  const [, setLocation] = useLocation()
  const switchConnection = useSetAtom(switchConnectionAtom)
  // anything but `stacked` is side by side, which is the default
  const side = config.editor_layout !== 'stacked'

  useEffect(() => {
    const onResult = onRunResult(setResult)
    const onHistory = onHistoryConnection(setHistory)
    // the main process switched this window's connection, and the documents it
    // was on went with the old one: the window moves to the session it now has
    const onConnection = onSetConnection(() => {
      switchConnection()
      setLocation('/')
    })

    return () => {
      onResult.dispose()
      onHistory.dispose()
      onConnection.dispose()
    }
  }, [])

  const handleDrag = throttle(sizes => {
    setSizes(sizes)
  }, 50)

  return (
    <WindowContainer>
      <div className='app'>
        <Titlebar>
          <span className='mono' style={{fontSize: 'var(--fs-sm)', color: 'var(--text)'}}>
            {connection.name}
          </span>
          <span className='muted'>·</span>
          <span className='muted'>{connection.is_over_ssh ? 'ssh' : 'local'}</span>
        </Titlebar>

        <div className='app__body'>
          <Sidebar/>

          {/* keyed by the direction: the split reads its direction when it is
              built, so turning it means building it again */}
          <Split
            key={side ? 'side' : 'stacked'}
            className={side ? 'main main--side' : 'main'}
            ref={splitRef}
            sizes={[50, 50]}
            minSize={100}
            gutterSize={6}
            gutter={splitGutter}
            direction={side ? 'horizontal' : 'vertical'}
            onDrag={handleDrag}
            style={{overflow: 'hidden'}}
          >
            <EditorPage/>

            <div className='output'>
              <Toolbar/>
              <OutputTabView/>
            </div>
          </Split>
        </div>

        <Statusbar/>

        <Route path='/connections/:id' component={ConnectionPage}/>
        <SnippetActions/>
        <DeleteSnippetConfirm/>
        <DeleteConnectionConfirm/>
      </div>
    </WindowContainer>
  )
}

export default EditorWindow
