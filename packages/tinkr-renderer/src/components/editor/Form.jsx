import {useCallback, useEffect, useState} from 'react'
import {useRoute} from 'wouter'
import {useAtomValue, useSetAtom} from 'jotai'
import debounce from 'lodash/debounce'
import {FormattedMessage} from 'react-intl'

import FormField from './FormField'
import NoFormFields from './NoFormFields'
import {snippetAtomWithId} from '../../stores/snippets'
import {runAtom} from '../../stores/editor'
import {parsePhpForm, stringifyPhpForm} from '../../utils/api'

/**
 * The snippet's form mode: the variables of the code as the design's form rows,
 * in the same well the code is edited in.
 *
 * The form is the one place a run starts from here, because the tab bar's Run
 * button is hidden in this mode.
 */
const Form = () => {
  const [, params] = useRoute('/snippets/:id/:mode')
  const snippet = useAtomValue(snippetAtomWithId(params.id))
  const run = useSetAtom(runAtom)
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
  const runDebounced = useCallback(debounce(code => run(code), 500), [])

  const runSnippet = async () => {
    const code = await stringifyPhpForm(fields)
    runDebounced(code)
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
          <button className='btn btn--primary' type='submit'>
            <FormattedMessage id='editor.run'/>
          </button>
        </div>
      </div>
    </form>
  )
}

export default Form
