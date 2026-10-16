import {useAtom} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'

import {editorViewAtom} from '../../stores/editor'

// the pane's two readings, in the order the switch offers them: the code, then
// the connection's own logs. Each names the message it reads, so no second set
// of words is invented for the same two things.
const views = [
  {name: 'tinker', id: 'editor.tinker'},
  {name: 'logs', id: 'editor.logs'},
]

/**
 * What the editor pane is showing.
 *
 * It sits in the strip above the pane, beside the actions that act on what the
 * pane holds, because that strip is the pane's own — a switch anywhere else
 * would be a second place to look for one surface. One radio per view, so the
 * keyboard reaches it and the arrow keys move between it and its neighbour.
 */
const EditorViews = () => {
  const intl = useIntl()
  const [view, setView] = useAtom(editorViewAtom)

  return (
    <div
      className='segmented'
      role='radiogroup'
      aria-label={intl.formatMessage({id: 'editor.views'})}
    >
      {views.map(({name, id}) => (
        <label key={name} className='segmented__item'>
          <input
            type='radio'
            name='editor-view'
            checked={view === name}
            onChange={() => setView(name)}
          />
          <FormattedMessage id={id}/>
        </label>
      ))}
    </div>
  )
}

export default EditorViews
