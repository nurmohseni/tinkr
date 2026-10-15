import {Route, Switch} from 'wouter'

import Editor from './editor/Editor'
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
 */
const EditorPage = () => (
  <section className='editor-pane' aria-label='Editor'>
    <Tabbar/>

    <div className='editor'>
      <Switch>
        <Route path='/snippets/:id/editor' component={Editor}/>
        <Route path='/snippets/:id/form' component={Form}/>
        <Route path='/' component={Editor}/>
      </Switch>
    </div>
  </section>
)

export default EditorPage
