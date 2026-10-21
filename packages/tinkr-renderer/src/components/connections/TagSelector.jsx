import {Controller, useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

import {STAGES} from '../../utils/stage'

/**
 * What kind of data the connection reaches, as one row of the five so the
 * choice is read at a glance rather than opened. Each carries the light its
 * stage wears in the sidebar and the titlebar. Production is the one tag that
 * changes what the app does — a run that writes is asked about before it is
 * sent (see the store's runAtom) — so choosing it is drawn in its vermilion
 * and the row under it says what it changes.
 */
const TagSelector = () => {
  const intl = useIntl()
  const {control} = useFormContext()

  return (
    <Controller
      name='tag'
      control={control}
      defaultValue='local'
      render={({
        field: {value, onChange},
      }) => (
        <>
          <div
            className='segmented segmented--fill tags'
            role='radiogroup'
            aria-labelledby='connection-tag-label'
          >
            {STAGES.map(tag => (
              <label
                key={tag}
                className={tag === 'production' ? 'segmented__item segmented__item--production' : 'segmented__item'}
              >
                <input
                  type='radio'
                  name='connection-tag'
                  value={tag}
                  checked={value === tag}
                  onChange={() => onChange(tag)}
                />
                <span className={`stage-dot stage--${tag}`} aria-hidden='true'/>
                {intl.formatMessage({id: `connections.tag_${tag}`})}
              </label>
            ))}
          </div>

          {value === 'production' && (
            <p className='cfield__note cfield__note--production'>
              {intl.formatMessage({id: 'connections.tag_production_hint'})}
            </p>
          )}
        </>
      )}
    />
  )
}

export default TagSelector
