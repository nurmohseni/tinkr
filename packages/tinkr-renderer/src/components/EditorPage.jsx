import {useIntl} from 'react-intl'
import {Route, Switch} from 'wouter'

import Editor from './editor/Editor'
import PhpMissing from './editor/PhpMissing'
import Tabbar from './editor/Tabbar'
import Form from './editor/Form'

/**
 * The editor pane: the tabs over the well the open document is edited in.
 *
 * The root route is the session the window is on, with no snippet open, and the
 * well holds that session there — the editor, the caret and Run all work, and
 * Save is what turns what has been typed into a snippet. A connection opens on
 * it, and the pane falls back to it when the snippet the window was on is closed
 * or deleted.
 *
 * A log is not one of them: it is read in a window of its own, opened from the
 * title bar, so the pane holds only the code and the answer it returns.
 */
const EditorPage = () => {
  const intl = useIntl()

  return (
  <section className='editor-pane' aria-label={intl.formatMessage({id: 'editor.pane'})}>
    <Tabbar/>

    <div className='editor'>
      <Switch>
        <Route path='/snippets/:id/editor' component={Editor}/>
        <Route path='/snippets/:id/form' component={Form}/>
        <Route path='/' component={Editor}/>
      </Switch>

      <PhpMissing/>
    </div>
  </section>
  )
}

export default EditorPage
