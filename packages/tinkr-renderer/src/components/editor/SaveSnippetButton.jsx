import {useAtomValue, useSetAtom} from 'jotai'
import {useIntl} from 'react-intl'

import {activeSessionAtom} from '../../stores/sessions'
import {saveSnippetPromptAtom} from '../../stores/snippetMenu'

/**
 * The quieter action next to Run on an unsaved session: turns what has been
 * typed into a snippet of the connection.
 *
 * It is not a create: a + starts an empty session, and what this one keeps is
 * the code already in the well — it asks for a name, and the session becomes
 * that snippet, with the tab it had. It is in the tab bar only while the window
 * is on a session, because a snippet is named on its own tab.
 */
const SaveSnippetButton = () => {
  const intl = useIntl()
  const setSaving = useSetAtom(saveSnippetPromptAtom)
  const session = useAtomValue(activeSessionAtom)
  const label = intl.formatMessage({id: 'editor.save_snippet'})

  return (
    <button
      className='btn btn--secondary'
      type='button'
      title={label}
      disabled={!session}
      onClick={() => setSaving(session.id)}
    >
      {intl.formatMessage({id: 'save'})}
    </button>
  )
}

export default SaveSnippetButton
