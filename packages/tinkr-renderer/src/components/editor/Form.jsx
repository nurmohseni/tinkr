import {useCallback, useEffect, useState} from 'react'
import {useRoute} from 'wouter'
import {useAtomValue, useSetAtom} from 'jotai'
import debounce from 'lodash/debounce'
import {FormattedMessage, useIntl} from 'react-intl'

import FormField from './FormField'
import NoFormFields from './NoFormFields'
import {snippetAtomWithId} from '../../stores/snippets'
import {runAtom} from '../../stores/editor'
import {configAtom} from '../../stores/config'
import {shortcutLabel} from '../../utils/isMatchShortcut'
import {parsePhpForm, stringifyPhpForm} from '../../utils/api'

/**
 * The snippet's form mode: the variables of the code as the design's form rows,
 * in the same well the code is edited in.
 *
 * The form is the one place a run starts from here, because the tab bar's Run
 * button is hidden in this mode — so it is the same button, word, glyph and
 * shortcut, as the one it stands in for.
 */
const Form = () => {
  const [, params] = useRoute('/snippets/:id/:mode')
  const intl = useIntl()
  const snippet = useAtomValue(snippetAtomWithId(params.id))
  const run = useSetAtom(runAtom)
  const config = useAtomValue(configAtom)
  const [fields, setFields] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const result = await parsePhpForm(snippet.code)
        setFields(result)
      } catch (e) {
        setError(e.message)
      }
    })()
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runDebounced = useCallback(debounce(code => run(code, {document: params.id}), 500), [params.id])

  const runSnippet = async () => {
    // the form's values are written into the code the form was read from, so
    // the snippet travels with them: a form carries no code of its own
    try {
      const code = await stringifyPhpForm(fields, snippet.code)
      runDebounced(code)
    } catch (e) {
      setError(e.message)
    }
  }

  const changeFieldValue = (index, value) => {
    setFields(fields.map((field, idx) => {
      if (idx === index) {
        return {
          ...field,
          value,
        }
      }
      return field
    }))
  }

  if (fields.length <= 0) {
    return <NoFormFields error={error}/>
  }

  return (
    <form
      className='form-grid'
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        alignContent: 'start',
        overflow: 'auto',
        padding: 'var(--s4)',
      }}
      onSubmit={event => {
        event.preventDefault()
        runSnippet()
      }}
    >
      {fields.map((field, index) => (
        <FormField
          key={`fields_${index}`}
          field={field}
          onChange={value => changeFieldValue(index, value)}
        />
      ))}

      <div className='form-row'>
        <span/>
        <div className='form-row__control'>
          <button className='btn btn--primary btn--run' type='submit' aria-label={intl.formatMessage({id: 'editor.run'})}>
            <svg width='12' height='12' viewBox='0 0 16 16' aria-hidden='true' fill='currentColor'>
              <path d='M4.8 3.1l7.6 4.9-7.6 4.9z'/>
            </svg>
            <FormattedMessage id='editor.run'/>
            <span className='keycap keycap--on-primary'>{shortcutLabel(config.shortcut_run)}</span>
          </button>
        </div>
      </div>
    </form>
  )
}

export default Form
