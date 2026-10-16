import {useAtom, useAtomValue} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'

import ReconnectButton from './ReconnectButton'
import Outcome from '../Outcome'
import {outputTabIndexAtom, resultAtom} from '../../stores/editor'

/**
 * The output panel's tab row, as the design draws it: the views as radio tabs,
 * with the last run's outcome beside the label of the view that shows it — the
 * tab reads as the assignment the run made — and the reconnect action where the
 * design puts the run's label.
 *
 * The design's Dump, Queries and Logs are not here: nothing in the app collects
 * what they would print.
 */
const Toolbar = () => {
  const intl = useIntl()
  const [tabIndex, setTabIndex] = useAtom(outputTabIndexAtom)
  const result = useAtomValue(resultAtom)

  // the glyph is the run's outcome, and it is unknown until a run lands: no
  // result, no mark on the tab
  const mark = () => {
    if (!result) {
      return null
    }

    return <Outcome kind={result.error ? 'threw' : (result.value === null ? 'printed' : 'returned')}/>
  }

  const tabs = [
    {index: 1, id: 'editor.output', mark: mark()},
    {index: 0, id: 'editor.terminal', mark: null},
    {index: 3, id: 'editor.logs', mark: null},
    {index: 2, id: 'editor.ai', mark: null},
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
          {tab.mark}
        </label>
      ))}

      <span className='grow'/>

      <ReconnectButton/>
    </div>
  )
}

export default Toolbar
