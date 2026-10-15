import {useIntl} from 'react-intl'
import {useLocation, useRoute} from 'wouter'

/**
 * The quieter action next to Run: opens the snippet's form, and closes it
 * again. It is only rendered when the feature is switched on, and for the
 * snippet the window is on, so the route it toggles is the one the window is
 * looking at; the pattern is read defensively all the same, because a button
 * that cannot act is no reason to take the window down with it.
 */
const FormButton = () => {
  const intl = useIntl()
  const [, setLocation] = useLocation()
  const [, params] = useRoute('/snippets/:id/:mode')

  const isFormMode = params?.mode === 'form'
  const label = intl.formatMessage({id: 'editor.form'})

  return (
    <button
      className='btn btn--secondary'
      type='button'
      title={label}
      aria-pressed={isFormMode}
      onClick={() => setLocation(`/snippets/${params.id}/${isFormMode ? 'editor' : 'form'}`)}
    >
      {label}
    </button>
  )
}

export default FormButton
