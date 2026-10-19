import {useCallback, useEffect, useRef} from 'react'
import {useAtom, useAtomValue} from 'jotai'
import {FormattedMessage, useIntl} from 'react-intl'

import ReconnectButton from './ReconnectButton'
import Outcome from '../Outcome'
import {outputTabIndexAtom, currentResultAtom} from '../../stores/editor'

/**
 * The output panel's tab row, as the design draws it: the views as radio tabs,
 * with the last run's outcome beside the label of the view that shows it — the
 * tab reads as the assignment the run made — and the reconnect action where the
 * design puts the run's label.
 *
 * The logs are not one of these views: a log line is as wide as it is, and the
 * editor pane is where they are read now, with the connection's files listed in
 * the sidebar. The design's Dump is not here either, because nothing in the app
 * collects what it would print. The design's Queries is: a run's queries are
 * captured as the run sends them, and nothing on this row says how many there
 * are or how the run went beyond the one mark — the view in hand says the rest.
 */
const Toolbar = () => {
  const intl = useIntl()
  const [tabIndex, setTabIndex] = useAtom(outputTabIndexAtom)
  const result = useAtomValue(currentResultAtom)
  const strip = useRef(null)

  // the strip scrolls its own overflow and nothing else's: bringing the view in
  // hand back into sight by hand leaves the panel and the window where they are
  const reveal = useCallback(() => {
    const row = strip.current
    const chosen = row
      ? [...row.querySelectorAll('.output__tab')].find(tab => tab.querySelector('input').checked)
      : null

    if (!row || !chosen) {
      return
    }

    const box = row.getBoundingClientRect()
    const label = chosen.getBoundingClientRect()

    if (label.left < box.left) {
      row.scrollLeft += label.left - box.left
    } else if (label.right > box.right) {
      row.scrollLeft += label.right - box.right
    }
  }, [])

  useEffect(() => {
    reveal()
  }, [tabIndex, reveal])

  // and the floor is not the window's to keep: a resize can carry the view in
  // hand out of sight without the tab ever changing
  useEffect(() => {
    if (!strip.current || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const watch = new ResizeObserver(reveal)

    watch.observe(strip.current)

    return () => watch.disconnect()
  }, [reveal])

  // the glyph is the run's outcome, and it is unknown until a run lands: no
  // result, no mark on the tab
  const mark = () => {
    if (!result) {
      return null
    }

    return <Outcome kind={result.error ? 'threw' : (result.value === null ? 'printed' : 'returned')}/>
  }

  // the queries the last run sent: the envelope carries them whether or not
  // that view is the one on. The count is not a number printed in the label —
  // at the window's floor the panel is about 272px wide and the four labels
  // plus the reconnect action need all of it, so what a run sent is said on
  // hover here and in words at the head of the view itself.
  const sent = (result && result.queries && result.queries.length) || 0

  const tabs = [
    {index: 1, id: 'editor.output', mark: mark()},
    {
      index: 3,
      id: 'editor.queries',
      mark: null,
      title: sent > 0 ? intl.formatMessage({id: 'queries.tab_title'}, {count: sent}) : undefined,
    },
    {index: 0, id: 'editor.terminal', mark: null},
    {index: 2, id: 'editor.ai', mark: null},
  ]

  return (
    <div
      className='tabset__list output__tabs'
      role='tablist'
      aria-label={intl.formatMessage({id: 'editor.output_views'})}
    >
      <div className='output__tabs-strip' ref={strip}>
        {tabs.map(tab => (
          <label key={tab.id} className='output__tab tabset__tab' title={tab.title}>
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
      </div>

      <ReconnectButton/>
    </div>
  )
}

export default Toolbar
