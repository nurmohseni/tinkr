import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import sections from './sections'
import appVersion from '../../utils/appVersion'
import {preferenceTabIndexAtom} from '../../stores/preference'

/**
 * The rail: the app's sections as sidebar rows, the open one tinted, and the
 * version pinned to the bottom.
 */
const PreferenceTab = () => {
  const intl = useIntl()
  const tabIndex = useAtomValue(preferenceTabIndexAtom)
  const setTabIndex = useSetAtom(preferenceTabIndexAtom)

  return (
    <aside
      className='sidebar rail'
      aria-label={intl.formatMessage({id: 'preference.preferences'})}
    >
      <nav className='sidebar__section'>
        <div className='sidebar__title'>
          <span>
            <FormattedMessage id='preference.preferences'/>
          </span>
          <span className='sidebar__meta'>{sections.length}</span>
        </div>

        {sections.map(({id, labelId, Icon}, index) => {
          const isActive = tabIndex === index

          return (
            <button
              key={id}
              className={isActive ? 'sidebar__item sidebar__item--active' : 'sidebar__item'}
              type='button'
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setTabIndex(index)}
            >
              <Icon/>
              <span>{intl.formatMessage({id: labelId})}</span>
            </button>
          )
        })}
      </nav>

      <div className='grow'/>

      <div
        className='sidebar__section'
        style={{paddingBottom: 'var(--s2)'}}
      >
        <div
          className='tree-nav__row'
          title={`Tinkr ${appVersion}`}
        >
          <span
            className='faint'
            style={{fontSize: 'var(--fs-xs)'}}
          >
            Tinkr {appVersion}
          </span>
        </div>
      </div>
    </aside>
  )
}

export default PreferenceTab
