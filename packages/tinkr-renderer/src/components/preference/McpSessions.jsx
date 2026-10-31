import {useCallback, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {FormattedMessage, useIntl} from 'react-intl'
import PropTypes from 'prop-types'

import Outcome from '../Outcome'
import {allConnections, clearMcpSessions, mcpSession, mcpSessions, openMcpCall} from '../../utils/api'

// how often the list is read again while the section is open: a client that is
// connected keeps calling, and its calls show up without leaving the screen
const refreshEvery = 3000

/**
 * @param {Object} intl
 * @param {Number} ms
 * @return {String} a length of time, in the unit that reads it best
 */
const lengthOf = (intl, ms) => {
  const seconds = Math.max(Math.round(ms / 1000), 0)
  const unit = (value, name, digits = 0) => intl.formatNumber(value, {
    style: 'unit',
    unit: name,
    unitDisplay: 'narrow',
    maximumFractionDigits: digits,
  })

  if (ms < 1000) {
    return unit(Math.max(ms, 0), 'millisecond')
  }

  if (seconds < 60) {
    return unit(ms / 1000, 'second', ms < 10000 ? 1 : 0)
  }

  if (seconds < 3600) {
    return unit(Math.round(seconds / 60), 'minute')
  }

  return unit(seconds / 3600, 'hour', 1)
}

/**
 * @param {Object} intl
 * @param {Number} at
 * @return {String} when, as a list reads it: the time today, the day before that
 */
const whenOf = (intl, at) => {
  const day = new Date(at).toDateString() === new Date().toDateString()
    ? ''
    : `${intl.formatDate(at, {day: 'numeric', month: 'short'})} `

  return `${day}${intl.formatTime(at, {hour: '2-digit', minute: '2-digit'})}`
}

/**
 * @param {String} code
 * @return {String} the first line that says something
 */
const firstLine = code => (code || '').split('\n').map(line => line.trim()).find(Boolean) || ''

/**
 * The id the MCP server gives a directory that is not one of the app's
 * connections (tinkr-mcp/src/target.js): a call there never ran in a saved
 * connection, which reads differently from one whose connection has since been
 * deleted.
 */
const directoryTargetId = 'cwd'

/**
 * Whether a call's code has an editor to open in, and when it has not, why.
 *
 * A call can only be opened in a connection the app still lists. A run in a
 * directory that is not a connection, and a run in a connection that has since
 * been deleted, both have nowhere to open — the first because there never was a
 * connection, the second because there is none any more.
 *
 * @param {Object} call
 * @param {Set<String>} connectionIds the connections the app has right now
 * @return {String|null} `open`, `no-connection`, `gone` or `cut`, and null for
 *   a call with no code to open
 */
const openableOf = (call, connectionIds) => {
  if (!call.code || call.code.trim() === '') {
    return null
  }

  if (!call.connection || !call.connection.id || call.connection.id === directoryTargetId) {
    return 'no-connection'
  }

  // the journal kept only the start of it: opened, it would be a different snippet
  if (call.code_cut) {
    return 'cut'
  }

  return connectionIds.has(call.connection.id) ? 'open' : 'gone'
}

/**
 * @param {Object} intl
 * @param {Object} call
 * @param {String} open a value openableOf answered
 * @return {String} one faint line saying why the code cannot be opened
 */
const reasonOf = (intl, call, open) => {
  if (open === 'no-connection') {
    return intl.formatMessage({id: 'preference.mcp_call_open_no_connection'})
  }

  if (open === 'cut') {
    return intl.formatMessage({id: 'preference.mcp_call_open_cut'})
  }

  return intl.formatMessage(
    {id: 'preference.mcp_call_open_gone'},
    {connection: (call.connection && call.connection.name) || ''},
  )
}

/**
 * Where a call ran, and the vermilion word when that was a production
 * connection: an agent's run there is the one thing on this list worth
 * reading first.
 */
const Where = ({connection}) => {
  const intl = useIntl()

  if (!connection) {
    return <span className='mcpcall__where faint'/>
  }

  return (
    <span className='mcpcall__where'>
      <span className='mcpcall__name'>{connection.name}</span>
      {connection.tag === 'production' && (
        <span className='mcpcall__stage stage--production'>
          {intl.formatMessage({id: 'connections.tag_production'})}
        </span>
      )}
    </span>
  )
}

Where.propTypes = {
  connection: PropTypes.shape({
    name: PropTypes.string,
    tag: PropTypes.string,
  }),
}

/**
 * What is offered under a call's code: the editor, or the line that says why it
 * cannot be opened there. Only drawn for a call that has code.
 */
const OpenAction = ({call, open, onOpen}) => {
  const intl = useIntl()

  if (open === 'open') {
    return (
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        onClick={() => onOpen(call)}
      >
        {intl.formatMessage({id: 'preference.mcp_call_open'})}
      </button>
    )
  }

  return <span className='mcpcall__reason'>{reasonOf(intl, call, open)}</span>
}

OpenAction.propTypes = {
  call: PropTypes.object.isRequired,
  open: PropTypes.string,
  onOpen: PropTypes.func.isRequired,
}

/**
 * One tool call: what it did, which tool, where, the code's first line, and how
 * long it took. A call with code or an error opens onto both, whole — and a call
 * that ran in a connection the app still has opens its code in the editor as a
 * new tab, without running it.
 */
const Call = ({call, connectionIds, onOpen}) => {
  const intl = useIntl()
  const open = openableOf(call, connectionIds)
  const line = call.outcome === 'threw' && !call.code ? call.error : firstLine(call.code)
  const head = (
    <>
      <Outcome kind={call.outcome}/>
      <span className='mcpcall__tool mono'>{call.tool}</span>
      <Where connection={call.connection}/>
      <span className={`mcpcall__line mono${call.outcome === 'threw' && !call.code ? ' mcpcall__line--error' : ''}`}>
        {line}
      </span>
      <span
        className='mcpcall__time faint nums'
        title={`${intl.formatDate(call.at)} ${intl.formatTime(call.at, {hour: '2-digit', minute: '2-digit', second: '2-digit'})}`}
      >
        {lengthOf(intl, call.ms)}
      </span>
    </>
  )

  if (!call.code && !call.error) {
    return <div className='mcpcall__row mcpcall__row--plain'>{head}</div>
  }

  return (
    <details className='mcpcall'>
      <summary className='mcpcall__row'>{head}</summary>

      <div className='mcpcall__detail'>
        {call.guard && (
          <div className={call.guard_forced ? 'mcpcall__meta mcpcall__meta--forced' : 'mcpcall__meta muted'}>
            <FormattedMessage
              id={call.guard_forced
                ? (call.mode_source === 'connection'
                    ? 'preference.mcp_call_guard_forced_connection'
                    : 'preference.mcp_call_guard_forced_settings')
                : 'preference.mcp_call_guard'}
              values={{guard: <span className='mono'>{call.guard}</span>}}
            />
          </div>
        )}
        {call.code && <pre className='mcpcall__code'>{call.code}</pre>}
        {call.error && <p className='mcpcall__error'>{call.error}</p>}
        {call.code && (
          <div className='mcpcall__actions'>
            <OpenAction
              call={call}
              open={open}
              onOpen={onOpen}
            />
          </div>
        )}
      </div>
    </details>
  )
}

Call.propTypes = {
  call: PropTypes.shape({
    tool: PropTypes.string.isRequired,
    at: PropTypes.number.isRequired,
    ms: PropTypes.number.isRequired,
    outcome: PropTypes.oneOf(['returned', 'printed', 'threw']).isRequired,
    connection: PropTypes.object,
    code: PropTypes.string,
    guard: PropTypes.string,
    // a guard the production mode forced, and where that mode came from
    guard_forced: PropTypes.bool,
    mode: PropTypes.oneOf(['refuse', 'guarded', 'allow']),
    mode_source: PropTypes.oneOf(['settings', 'connection']),
    error: PropTypes.string,
  }).isRequired,
  connectionIds: PropTypes.instanceOf(Set).isRequired,
  onOpen: PropTypes.func.isRequired,
}

/**
 * One session: the client, where its calls went, how many, and when. Opened,
 * it lists the calls, newest first.
 */
const Session = ({summary, detail, onToggle, connectionIds, onOpen}) => {
  const intl = useIntl()
  const client = summary.client && summary.client.name
    ? summary.client.name
    : intl.formatMessage({id: 'preference.mcp_session_unknown_client'})
  const where = summary.connections.length
    ? summary.connections.join(', ')
    : (summary.target && summary.target.name) || ''
  const ran = summary.live
    ? intl.formatMessage({id: 'preference.mcp_session_live'})
    : lengthOf(intl, summary.ended_at - summary.started_at)
  const calls = detail ? detail.calls : null

  return (
    <details
      className='mcpsession'
      onToggle={event => onToggle(summary.id, event.currentTarget.open)}
    >
      <summary className='mcpsession__row'>
        <span className='tree__caret'/>
        <span className='mcpsession__client'>
          {client}
          {summary.client && summary.client.version && (
            <span className='faint nums'> {summary.client.version}</span>
          )}
        </span>
        <span
          className='mcpsession__where muted'
          title={where}
        >
          {where}
        </span>
        <span className='mcpsession__calls muted nums'>
          {intl.formatMessage({id: 'preference.mcp_session_calls'}, {count: summary.calls_total})}
          {summary.threw > 0 && (
            <span className='mcpsession__threw'>
              {' · '}
              {intl.formatMessage({id: 'preference.mcp_session_threw'}, {count: summary.threw})}
            </span>
          )}
        </span>
        <span className='mcpsession__when nums'>
          <span className='faint'>{whenOf(intl, summary.started_at)}</span>
          <span className={summary.live ? 'mcpsession__live' : 'faint'}>{ran}</span>
        </span>
      </summary>

      {calls && (
        <div className='mcpsession__calls-list'>
          {calls.length === 0 && (
            <p className='mcpsession__note faint'>
              {intl.formatMessage({id: 'preference.mcp_session_no_calls'})}
            </p>
          )}
          {calls.map((call, index) => (
            <Call
              // calls are only ever added, newest first: the count from the end
              // is the same call on every read
              key={calls.length - index}
              call={call}
              connectionIds={connectionIds}
              onOpen={onOpen}
            />
          ))}
          {detail.calls_total > calls.length && (
            <p className='mcpsession__note faint'>
              {intl.formatMessage({id: 'preference.mcp_session_cut'}, {kept: calls.length, count: detail.calls_total})}
            </p>
          )}
        </div>
      )}
    </details>
  )
}

Session.propTypes = {
  summary: PropTypes.shape({
    id: PropTypes.string.isRequired,
    client: PropTypes.shape({name: PropTypes.string, version: PropTypes.string}),
    target: PropTypes.shape({name: PropTypes.string}),
    started_at: PropTypes.number.isRequired,
    ended_at: PropTypes.number,
    live: PropTypes.bool.isRequired,
    calls_total: PropTypes.number.isRequired,
    threw: PropTypes.number.isRequired,
    connections: PropTypes.arrayOf(PropTypes.string).isRequired,
  }).isRequired,
  detail: PropTypes.object,
  onToggle: PropTypes.func.isRequired,
  connectionIds: PropTypes.instanceOf(Set).isRequired,
  onOpen: PropTypes.func.isRequired,
}

/**
 * What MCP clients did through the app's server: every session, newest first,
 * each one opening onto the tools it called.
 *
 * The server writes a session as it goes, so the list is read again every few
 * seconds while it is on screen, and an open session reads its calls again with
 * it.
 */
const McpSessions = () => {
  const intl = useIntl()
  const [list, setList] = useState(null)
  const [details, setDetails] = useState({})
  const [connectionIds, setConnectionIds] = useState(() => new Set(Object.keys(allConnections())))
  const [asking, setAsking] = useState(false)
  const open = useRef(new Set())

  const load = useCallback(async () => {
    const sessions = await mcpSessions()
    const read = await Promise.all([...open.current].map(async id => [id, await mcpSession(id)]))

    setList(sessions)
    // the connections are read again with the list: a connection deleted while
    // this screen was open is one of its calls can no longer open in
    setConnectionIds(new Set(Object.keys(allConnections())))
    setDetails(current => {
      const next = {}

      for (const [id, detail] of read) {
        next[id] = detail || current[id]
      }

      return next
    })
  }, [])

  useEffect(() => {
    let stopped = false

    const tick = () => {
      if (!stopped && document.visibilityState !== 'hidden') {
        load().catch(() => {})
      }
    }

    tick()

    const timer = setInterval(tick, refreshEvery)

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [load])

  const toggle = async (id, isOpen) => {
    if (!isOpen) {
      open.current.delete(id)

      return
    }

    open.current.add(id)

    const detail = await mcpSession(id)

    setDetails(current => ({...current, [id]: detail}))
  }

  const clear = async () => {
    setAsking(false)
    setList(await clearMcpSessions())
  }

  /**
   * A call's code, opened in the editor window: the main process switches that
   * window to the call's connection and starts the tab there, and the tab is
   * named for the tool and the time the call ran.
   *
   * @param {Object} call
   */
  const openInEditor = call => {
    openMcpCall({
      connectionId: call.connection.id,
      name: `${call.tool} · ${intl.formatTime(call.at, {hour: '2-digit', minute: '2-digit'})}`,
      code: call.code,
    }).then(result => {
      // a connection that went away between the last read and this press is one
      // this screen has not caught up with: what it answered says so
      if (result && result.opened === false) {
        setConnectionIds(new Set(Object.keys(allConnections())))
      }
    }).catch(() => {})
  }

  const sessions = list || []
  const ended = sessions.filter(one => !one.live).length

  return (
    <div className='mcppane'>
      <div className='mcppane__head'>
        <span className='field__label'>
          {intl.formatMessage({id: 'preference.mcp_sessions'})}
        </span>
        <span className='mcpsessions__count faint nums'>{sessions.length}</span>
        <span className='grow'/>
        <button
          className='btn btn--secondary btn--sm'
          type='button'
          disabled={ended === 0}
          onClick={() => setAsking(true)}
        >
          {intl.formatMessage({id: 'preference.mcp_sessions_clear'})}
        </button>
      </div>

      <div className='mcppane__note'>
        {intl.formatMessage({id: 'preference.mcp_sessions_description'})}
      </div>

      <div className='mcpsessions'>
        {list !== null && sessions.length === 0 && (
          <div className='empty empty--benign'>
            <Outcome kind='printed'/>
            <p>{intl.formatMessage({id: 'preference.mcp_sessions_empty'})}</p>
            <p>{intl.formatMessage({id: 'preference.mcp_sessions_empty_help'})}</p>
          </div>
        )}

        {sessions.map(summary => (
          <Session
            key={summary.id}
            summary={summary}
            detail={details[summary.id]}
            onToggle={toggle}
            connectionIds={connectionIds}
            onOpen={openInEditor}
          />
        ))}
      </div>

      {asking && createPortal(
        <div className='modal-overlay'>
          <div
            className='modal modal--narrow'
            role='dialog'
            aria-modal='true'
            aria-labelledby='clear-mcp-sessions-title'
          >
            <header
              className='modal__header'
              id='clear-mcp-sessions-title'
            >
              {intl.formatMessage({id: 'preference.mcp_sessions_clear_title'})}
            </header>

            <div className='modal__body'>
              {intl.formatMessage({id: 'preference.mcp_sessions_clear_content'}, {count: ended})}
            </div>

            <footer className='modal__footer'>
              <button
                className='btn btn--ghost'
                type='button'
                onClick={() => setAsking(false)}
              >
                {intl.formatMessage({id: 'cancel'})}
              </button>

              <button
                className='btn btn--danger'
                type='button'
                onClick={clear}
              >
                {intl.formatMessage({id: 'preference.mcp_sessions_clear'})}
              </button>
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default McpSessions

// the presence rules and the call's own detail, for the tests: the button is
// the one thing on this screen that asks the main process to do something
export {Call, openableOf}
