import PropTypes from 'prop-types'
import {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {useIntl} from 'react-intl'

/**
 * The app's prompt for a snippet's name, as the design's narrow modal — the one
 * dialog both naming a snippet and renaming one are: they ask the same thing,
 * validate it the same way and answer the same keys, so they are one component
 * twice rather than two that drift apart.
 *
 * A name cannot be empty: the confirm is inert until there is one and the field
 * says so. Enter confirms and Escape cancels, Enter because the two buttons are
 * the form's own, Escape here because nothing else in the window hears a key
 * pressed inside a modal.
 *
 * It is portalled to the body, like the app's other dialogs: a modal belongs
 * over the whole window, not inside the sidebar or the tab bar that raised it.
 */
const SnippetNameDialog = ({isOpen, title, label, defaultValue, confirmLabel, onConfirm, onCancel}) => {
  const intl = useIntl()
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef()

  // every opening starts from what it was given — the snippet's name now, or the
  // name a new snippet is offered — and puts the caret in the field
  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue)
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen, defaultValue])

  if (!isOpen) {
    return null
  }

  const name = value.trim()

  const submit = event => {
    event.preventDefault()

    if (!name) {
      return
    }

    onConfirm(name)
  }

  const onKeyDown = event => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    }
  }

  return createPortal(
    <div className='modal-overlay' onKeyDown={onKeyDown}>
      <form
        className='modal modal--narrow'
        role='dialog'
        aria-modal='true'
        aria-labelledby='snippet-name-title'
        onSubmit={submit}
      >
        <header className='modal__header' id='snippet-name-title'>{title}</header>

        <div className='modal__body'>
          <div className='field'>
            <label className='field__label' htmlFor='snippet-name'>{label}</label>

            <input
              className={name ? 'input' : 'input input--error'}
              id='snippet-name'
              ref={inputRef}
              type='text'
              value={value}
              aria-invalid={name ? undefined : 'true'}
              onChange={event => setValue(event.target.value)}
              autoComplete='off'
              spellCheck={false}
            />

            {!name && (
              <span className='field__error'>
                {intl.formatMessage({id: 'editor.snippet_name_required'})}
              </span>
            )}
          </div>
        </div>

        <footer className='modal__footer'>
          <button
            className='btn btn--ghost'
            type='button'
            onClick={onCancel}
          >
            {intl.formatMessage({id: 'cancel'})}
          </button>

          <button
            className='btn btn--primary'
            type='submit'
            disabled={!name}
          >
            {confirmLabel}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

SnippetNameDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  defaultValue: PropTypes.string,
  confirmLabel: PropTypes.string.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
}

SnippetNameDialog.defaultProps = {
  defaultValue: '',
}

export default SnippetNameDialog
