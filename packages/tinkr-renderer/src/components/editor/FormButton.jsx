import {useIntl} from 'react-intl'
import {useRoute} from 'wouter'
import useHashLocation from '../../utils/useHashLocation'

/**
 * The quieter action next to Run: opens the snippet's form, and closes it
 * again.
 *
 * It is an icon, and which icon is the state: a form means the snippet has one
 * and the click leaves it, code means the snippet is being edited and the click
 * opens it — with the sentence either way in the tooltip, since a button's width
 * is not the place for it.
 *
 * It is only rendered when the feature is switched on, and for the snippet the
 * window is on, so the route it toggles is the one the window is looking at; the
 * pattern is read defensively all the same, because a button that cannot act is
 * no reason to take the window down with it.
 */
const FormButton = () => {
  const intl = useIntl()
  const [, setLocation] = useHashLocation()
  const [, params] = useRoute('/snippets/:id/:mode')

  const isFormMode = params?.mode === 'form'
  // the tooltip is the one place the click is spelled out, so it says what the
  // click does: the icon already tells which mode the snippet is in
  const label = intl.formatMessage({id: isFormMode ? 'editor.form_edit_code' : 'editor.form'})

  return (
    <button
      className='btn btn--secondary btn--icon'
      type='button'
      title={label}
      aria-label={label}
      aria-pressed={isFormMode}
      onClick={() => setLocation(`/snippets/${params.id}/${isFormMode ? 'editor' : 'form'}`)}
    >
      <svg
        width='14'
        height='14'
        viewBox='0 0 16 16'
        aria-hidden='true'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
      >
        {isFormMode ? (
          // back to the code: a chevron pair, the way every editor writes it
          <path d='M6.1 4.4L2.6 8l3.5 3.6M9.9 4.4L13.4 8l-3.5 3.6'/>
        ) : (
          // a form: the box with its labelled rows in it
          <>
            <rect x='2.4' y='2.8' width='11.2' height='10.4' rx='1.8'/>
            <path d='M4.9 6.3h2M8.2 6.3h3'/>
            <path d='M4.9 9.7h2M8.2 9.7h3'/>
          </>
        )}
      </svg>
    </button>
  )
}

export default FormButton
