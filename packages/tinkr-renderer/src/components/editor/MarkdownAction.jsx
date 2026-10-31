import PropTypes from 'prop-types'
import {useEffect, useRef, useState} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'

import {copyText} from '../../utils/clipboard'
import {guardReport, sandboxReport} from '../../utils/guardReport'
import {runMarkdown} from '../../utils/markdown'

/**
 * What a run looks like outside the app: one Markdown block, on the clipboard.
 *
 * It sits with the pane's other actions, beside Copy and the CSV menu, because
 * it is the same thing those are — the answer taken out of the app. What it
 * takes is the whole run, not the reading on screen: the code that was sent,
 * every value it answered, what it printed, its queries and its guard, so the
 * person receiving it has the run rather than a screenshot of it.
 *
 * The button says it copied for a moment, the way the MCP settings say a value
 * was copied: a clipboard write has no visible result of its own, and a click
 * that looks like nothing happened is a click people make twice.
 */
const MarkdownAction = ({result, code = '', connection = ''}) => {
  const intl = useIntl()
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  // another run is another block, and a confirmation about the last one is not
  // about this one
  useEffect(() => {
    setCopied(false)
    clearTimeout(timer.current)
  }, [result])

  const copy = () => {
    const report = guardReport(result.transaction, result)
    const sealed = sandboxReport(result.sandbox)
    const dryRun = []
    const sandbox = []

    if (report) {
      dryRun.push(intl.formatMessage({id: report.id}, report.values))
      report.unguarded.forEach(({connection: name, count}) => {
        dryRun.push(intl.formatMessage({id: report.unguardedId}, {count, connection: name}))
      })
    }

    if (sealed) {
      sandbox.push(intl.formatMessage({id: sealed.id}, sealed.values))
      sandbox.push(...sealed.sent, ...sealed.requested)
      sealed.notSandboxed.forEach(reason => {
        sandbox.push(intl.formatMessage({id: 'guard.sandbox_not'}, {reason}))
      })
    }

    const at = result.ranAt ? new Date(result.ranAt) : null

    copyText(runMarkdown({
      code,
      result,
      connection,
      when: at && !Number.isNaN(at.getTime())
        ? `${intl.formatDate(at, {year: 'numeric', month: 'short', day: 'numeric'})} ${intl.formatTime(at, {hour: 'numeric', minute: '2-digit'})}`
        : '',
      labels: {
        connection: intl.formatMessage({id: 'result.markdown_connection'}),
        when: intl.formatMessage({id: 'result.markdown_when'}),
        returned: intl.formatMessage({id: 'result.markdown_returned'}),
        printed: intl.formatMessage({id: 'result.markdown_printed'}),
        error: intl.formatMessage({id: 'result.markdown_error'}),
        queries: intl.formatMessage({id: 'result.markdown_queries'}),
        dryRun: intl.formatMessage({id: 'result.markdown_dry_run'}),
        sandbox: intl.formatMessage({id: 'result.markdown_sandbox'}),
        statement: line => intl.formatMessage({id: 'result.markdown_statement'}, {line}),
        truncated: count => intl.formatMessage({id: 'result.markdown_truncated'}, {count}),
        moreQueries: count => intl.formatMessage({id: 'queries.more'}, {count}),
        sql: intl.formatMessage({id: 'queries.col_sql'}),
        bindings: intl.formatMessage({id: 'queries.col_bindings'}),
        ms: intl.formatMessage({id: 'queries.col_ms'}),
        connectionColumn: intl.formatMessage({id: 'queries.col_connection'}),
      },
      guarded: {dryRun, sandbox},
    }))

    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      className='btn btn--ghost btn--sm'
      type='button'
      title={intl.formatMessage({id: 'result.copy_markdown'})}
      onClick={copy}
    >
      {copied
        ? <FormattedMessage id='result.copied'/>
        : <FormattedMessage id='result.markdown'/>}
    </button>
  )
}

MarkdownAction.propTypes = {
  code: PropTypes.string,
  connection: PropTypes.string,
  result: PropTypes.object.isRequired,
}

export default MarkdownAction
