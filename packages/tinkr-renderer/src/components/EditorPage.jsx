import {useIntl} from 'react-intl'
import {useAtomValue} from 'jotai'
import {Route, Switch} from 'wouter'

import Editor from './editor/Editor'
import PhpMissing from './editor/PhpMissing'
import Tabbar from './editor/Tabbar'
import Form from './editor/Form'
import LogsPanel from './editor/LogsPanel'
import {editorViewAtom} from '../stores/editor'

/**
 * The editor pane: the tabs over the well the open document is edited in.
 *
 * The root route is the session the window is on, with no snippet open, and the
 * well holds that session there — the editor, the caret and Run all work, and
 * Save is what turns what has been typed into a snippet. A connection opens on
 * it, and the pane falls back to it when the snippet the window was on is closed
 * or deleted.
 *
 * The pane has a second reading: the connection's own log files, which want the
 * width a run's output panel cannot give them. The switch between the two is in
 * the strip above, which is the pane's own.
 */
const EditorPage = () => {
  const intl = useIntl()
  const view = useAtomValue(editorViewAtom)

  return (
  <section className='editor-pane' aria-label={intl.formatMessage({id: 'editor.pane'})}>
    <Tabbar/>

    {view === 'logs' ? <LogsPanel/> : (
      <div className='editor'>
        <Switch>
          <Route path='/snippets/:id/editor' component={Editor}/>
          <Route path='/snippets/:id/form' component={Form}/>
          <Route path='/' component={Editor}/>
        </Switch>

        <PhpMissing/>
      </div>
    )}
  </section>
  )
}

export default EditorPage
