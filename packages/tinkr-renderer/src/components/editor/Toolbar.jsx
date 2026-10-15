import {useAtom, useAtomValue} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'

import ReconnectButton from './ReconnectButton'
import {outputTabIndexAtom, resultAtom} from '../../stores/editor'

/**
 * The output panel's tab row, as the design draws it: the views as radio tabs
 * with the run's state on the one that shows it, and the reconnect action where
 * the design puts the run's label.
 *
 * The design's Dump, Queries and Logs are not here: nothing in the app collects
 * what they would print.
 */
const Toolbar = () => {
  const intl = useIntl()
  const [tabIndex, setTabIndex] = useAtom(outputTabIndexAtom)
  const result = useAtomValue(resultAtom)

  const badge = () => {
    if (!result) {
      return null
    }

    return result.error
      ? <span className='badge badge--error'>{intl.formatMessage({id: 'editor.failed'})}</span>
      : <span className='badge badge--success'>{intl.formatMessage({id: 'editor.ok'})}</span>
  }

  const tabs = [
    {index: 1, id: 'editor.output', badge: badge()},
    {index: 0, id: 'editor.terminal', badge: null},
    {index: 2, id: 'editor.ai', badge: null},
  ]

  return (
    <div
      className='tabset__list output__tabs'
      role='tablist'
      aria-label={intl.formatMessage({id: 'editor.output_views'})}
    >
      {tabs.map(tab => (
        <label key={tab.id} className='output__tab tabset__tab'>
          <input
            type='radio'
            name='output-view'
            checked={tabIndex === tab.index}
            onChange={() => setTabIndex(tab.index)}
          />
          <FormattedMessage id={tab.id}/>
          {tab.badge}
        </label>
      ))}

      <span className='grow'/>

      <ReconnectButton/>
    </div>
  )
}

export default Toolbar
