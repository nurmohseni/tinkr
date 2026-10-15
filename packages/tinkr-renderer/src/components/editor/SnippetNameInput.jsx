import PropTypes from 'prop-types'
import {useEffect, useMemo, useRef, useState} from 'react'
import debounce from 'lodash/debounce'

/**
 * The name of the open snippet, edited in place on its tab.
 *
 * The field is the tab's label, so it keeps the tab's own type and colour; only
 * the value is written back to the store, debounced the way it has always been.
 */
const SnippetNameInput = ({value, onChange}) => {
  const [inputValue, setInputValue] = useState(value)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commit = useMemo(() => debounce(name => onChangeRef.current(name), 100), [])

  useEffect(() => {
    setInputValue(value)
  }, [value])

  return (
    <input
      className='tab__name'
      type='text'
      value={inputValue}
      onChange={event => {
        setInputValue(event.target.value)
        commit(event.target.value)
      }}
      aria-label='Snippet name'
      spellCheck={false}
    />
  )
}

SnippetNameInput.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
}

export default SnippetNameInput
