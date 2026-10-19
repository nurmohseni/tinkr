import {useEffect} from 'react'
import Split from 'react-split'
import {Route} from 'wouter'
import {useAtomValue, useSetAtom} from 'jotai'
import throttle from 'lodash/throttle'
import useHashLocation from './utils/useHashLocation'

import EditorPage from './components/EditorPage'
import WindowContainer from './components/WindowContainer'
import Titlebar from './components/Titlebar'
import Statusbar from './components/Statusbar'
import Sidebar from './components/editor/Sidebar'
import Toolbar from './components/editor/Toolbar'
import OutputTabView from './components/editor/OutputTabView'
import SnippetActions from './components/editor/SnippetActions'
import ClearHistoryConfirm from './components/editor/ClearHistoryConfirm'
import UpdatePrompt from './components/editor/UpdatePrompt'
import DeleteSnippetConfirm from './components/editor/DeleteSnippetConfirm'
import ConnectionPage from './components/ConnectionPage'
import DeleteConnectionConfirm from './components/connections/DeleteConnectionConfirm'
import useSplit from './hooks/useSplit'
import {sizesAtom, resultAtom, connectionAtom, settledRunAtom} from './stores/editor'
import {configAtom} from './stores/config'
import {historyListAtom} from './stores/history'
import {snippetsConnectionAtom} from './stores/snippets'
import {switchConnectionAtom} from './stores/connections'
import {phpVersionAnsweredAtom} from './stores/php'
import {
  updateAvailableAtom,
  updateDownloadedAtom,
  updateFailedAtom,
  updateNotAvailableAtom,
  updateProgressAtom,
} from './stores/update'
import {
  onRunResult,
  onHistoryConnection,
  onSnippetsConnection,
  onSetConnection,
  onPhpVersion,
  onUpdateState,
} from './utils/api'

// the split handle is the design's 9px divider, which is the room the `=` grip
// needs and the hit area that makes it easy to grab, not react-split's 10px
// default
const splitGutter = (index, direction) => {
  const gutter = document.createElement('div')

  gutter.className = `gutter gutter-${direction} split`
  // the handle is a hit area, not a control: it takes no keys and says nothing
  gutter.setAttribute('aria-hidden', 'true')

  return gutter
}

const EditorWindow = () => {
  const {splitRef} = useSplit()
  const setSizes = useSetAtom(sizesAtom)
  const setResult = useSetAtom(resultAtom)
  const setHistory = useSetAtom(historyListAtom)
  const connection = useAtomValue(connectionAtom)
  const config = useAtomValue(configAtom)
  const [, setLocation] = useHashLocation()
  const switchConnection = useSetAtom(switchConnectionAtom)
  const setUpdateAvailable = useSetAtom(updateAvailableAtom)
  const setUpdateNotAvailable = useSetAtom(updateNotAvailableAtom)
  const setUpdateProgress = useSetAtom(updateProgressAtom)
  const setUpdateDownloaded = useSetAtom(updateDownloadedAtom)
  const setUpdateFailed = useSetAtom(updateFailedAtom)
  const setPhpVersion = useSetAtom(phpVersionAnsweredAtom)
  const setSettled = useSetAtom(settledRunAtom)
  const setSnippets = useSetAtom(snippetsConnectionAtom)
  const updates = {
    updateAvailable: setUpdateAvailable,
    updateNotAvailable: setUpdateNotAvailable,
    updateProgress: setUpdateProgress,
    updateDownloaded: setUpdateDownloaded,
    updateFailed: setUpdateFailed,
  }
  // anything but `stacked` is side by side, which is the default
  const side = config.editor_layout !== 'stacked'

  useEffect(() => {
    // the answer is the end of the run, whichever way it came: the stop it may
    // have been given is done with
    const onResult = onRunResult(result => {
      setResult(result)
      setSettled()
    })
    const onHistory = onHistoryConnection(setHistory)
    // the snippets a client's MCP server saved or deleted are this connection's:
    // the store takes them as they now stand rather than being told one at a
    // time, because the writer was another process and the whole file is what it
    // changed
    const onSnippets = onSnippetsConnection(setSnippets)
    // the main process switched this window's connection, and the documents it
    // was on went with the old one: the window moves to the session it now has
    const onConnection = onSetConnection(() => {
      switchConnection()
      setLocation('/')
    })

    // what the updater is doing, as it does it: it asks before it downloads and
    // before it installs, and both questions are the panel below
    const onUpdate = Object.entries(updates).map(([channel, set]) => onUpdateState(channel)(set))

    // what the connection answered about php, which the status bar shows and the
    // pane warns about when there was no answer
    const onPhp = onPhpVersion(setPhpVersion)

    return () => {
      onResult.dispose()
      onHistory.dispose()
      onSnippets.dispose()
      onConnection.dispose()
      onUpdate.forEach(dispose => dispose.dispose())
      onPhp.dispose()
    }
  }, [])

  const handleDrag = throttle(sizes => {
    setSizes(sizes)
  }, 50)

  return (
    <WindowContainer>
      <div className='app'>
        <Titlebar>
          <span className='mono'>{connection.name}</span>
          <span className='titlebar__sep'>·</span>
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
            gutterSize={9}
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
        <ClearHistoryConfirm/>
        <UpdatePrompt/>
        <DeleteConnectionConfirm/>
      </div>
    </WindowContainer>
  )
}

export default EditorWindow
