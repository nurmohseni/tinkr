import {useIntl} from 'react-intl'
import {Route, Switch, useRoute} from 'wouter'

import Editor from './editor/Editor'
import PhpMissing from './editor/PhpMissing'
import Tabbar from './editor/Tabbar'
import Form from './editor/Form'
import LogsView from './editor/LogsView'

/**
 * The editor pane: the tabs over the well the open document is edited in.
 *
 * The root route is the session the window is on, with no snippet open, and the
 * well holds that session there — the editor, the caret and Run all work, and
 * Save is what turns what has been typed into a snippet. A connection opens on
 * it, and the pane falls back to it when the snippet the window was on is closed
 * or deleted.
 *
 * A log file is one of the documents this pane holds, at its own route: it wants
 * the width a run's output panel cannot give it, and it is opened and closed the
 * way a snippet is, from the list in the sidebar.
 */
const EditorPage = () => {
  const intl = useIntl()
  const [isLog] = useRoute('/logs/:name')

  return (
  <section className='editor-pane' aria-label={intl.formatMessage({id: 'editor.pane'})}>
    <Tabbar/>

    {isLog ? <LogsView/> : (
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
