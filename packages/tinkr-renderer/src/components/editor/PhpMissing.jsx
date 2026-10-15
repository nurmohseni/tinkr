import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import {dismissPhpWarningAtom, phpVersionAtom} from '../../stores/php'

/**
 * The warning over the code when the connection answered nothing about php.
 *
 * It sits on the editor rather than over the window, so the terminal and the
 * output of the connection stay where they are and can be read: whatever went
 * wrong there is the reason this is up. Running tinker anyway is a button, not a
 * thing the app decides — a connection the app cannot question may still be one
 * that runs fine.
 */
const PhpMissing = () => {
  const php = useAtomValue(phpVersionAtom)
  const dismiss = useSetAtom(dismissPhpWarningAtom)
  const intl = useIntl()

  if (php.status !== 'missing' || php.dismissed) {
    return null
  }

  return (
    <div className='pane-warning'>
      <div className='pane-warning__card' role='alert'>
        <div className='pane-warning__title'>
          <FormattedMessage id='editor.php_missing_title'/>
        </div>

        <p className='pane-warning__text'>
          <FormattedMessage id='editor.php_missing_content'/>
        </p>

        <button
          className='btn btn--primary'
          type='button'
          onClick={dismiss}
        >
          {intl.formatMessage({id: 'editor.php_run_anyway'})}
        </button>
      </div>
    </div>
  )
}

export default PhpMissing
