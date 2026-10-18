import {useIntl} from 'react-intl'
import {useAtomValue} from 'jotai'

import sections from './sections'
import {preferenceTabIndexAtom} from '../../stores/preference'

/**
 * The open section, as the design's settings column: one section head over one
 * card of `.setting` rows.
 */
const PreferenceForm = () => {
  const intl = useIntl()
  const tabIndex = useAtomValue(preferenceTabIndexAtom)

  const section = sections[tabIndex] || sections[0]
  const {Form} = section

  return (
    <main className='main'>
      <div className='settings'>
        {/* the frame is the desk and does not scroll: what scrolls is the column
            inside it, so the desk's lip stays where the desk is */}
        <div className='settings__scroll'>
          <div className='settings__inner'>
            <section
              className='sgroup'
              id={section.id}
              aria-labelledby={`settings-${section.id}-title`}
            >
              <header className='sgroup__head'>
                <div className='sgroup__titles'>
                  <h2
                    className='sgroup__title'
                    id={`settings-${section.id}-title`}
                  >
                    {intl.formatMessage({id: section.labelId})}
                  </h2>
                </div>
              </header>

              <div className='scard'>
                <Form/>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}

export default PreferenceForm
