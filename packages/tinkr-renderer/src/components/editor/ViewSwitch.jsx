import {useAtom} from 'jotai'
import {FormattedMessage} from 'react-intl'

import {LinesIcon, ReturnIcon} from './icons'
import {editorViewAtom} from '../../stores/editor'

/**
 * The one way between the editor pane's two readings, at the foot of the sidebar.
 *
 * It is a button, not a switch with two states on screen: it says what it will
 * do — the pane you are not looking at — and one press is that. Its mark is the
 * app's own for whichever half is behind it: the return bars for the tinker, the
 * lines a log is made of for the logs.
 */
const ViewSwitch = () => {
  const [view, setView] = useAtom(editorViewAtom)
  const toLogs = view !== 'logs'

  return (
    <button
      className='tree-nav__row pane-switch'
      type='button'
      onClick={() => setView(toLogs ? 'logs' : 'tinker')}
    >
      {toLogs ? <LinesIcon/> : <ReturnIcon/>}
      <span className='truncate'>
        <FormattedMessage id={toLogs ? 'editor.switch_to_logs' : 'editor.switch_to_tinker'}/>
      </span>
    </button>
  )
}

export default ViewSwitch
