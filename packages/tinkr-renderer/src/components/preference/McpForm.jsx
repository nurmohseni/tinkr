import {useState} from 'react'
import {useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import Outcome from '../Outcome'
import SegmentedField from './SegmentedField'
import McpSessions from './McpSessions'
import {configAtom, setConfigAtom} from '../../stores/config'
import {connectionListAtom, updateConnectionAtom} from '../../stores/connections'
import {configureClientAtom, mcpAtom, reloadMcpAtom} from '../../stores/mcp'

/**
 * What a run on a connection tagged production may do, as the segmented control
 * offers it: the server reads the value on every run.
 */
const productionOptions = [
  {value: 'refuse', labelId: 'preference.mcp_production_refuse'},
  {value: 'guarded', labelId: 'preference.mcp_production_guarded'},
  {value: 'allow', labelId: 'preference.mcp_production_allow'},
]

/**
 * A connection's own access, which sits on the connection rather than in the
 * preferences: '' follows the setting above.
 */
const accessOptions = [
  {value: '', labelId: 'preference.mcp_access_follow'},
  ...productionOptions,
]

/**
 * What each tool the server offers does, in the app's own words. The names are
 * the server's, and a tool this does not know is listed as its name alone rather
 * than as a message the app does not have.
 */
const toolMessages = {
  tinkr_run_php: 'preference.mcp_tool_run_php',
  tinkr_run_php_over_ssh: 'preference.mcp_tool_run_php_over_ssh',
  tinkr_list_history: 'preference.mcp_tool_list_history',
  tinkr_read_run: 'preference.mcp_tool_read_run',
  tinkr_list_logs: 'preference.mcp_tool_list_logs',
  tinkr_tail_logs: 'preference.mcp_tool_tail_logs',
  tinkr_list_connections: 'preference.mcp_tool_list_connections',
  tinkr_list_snippets: 'preference.mcp_tool_list_snippets',
  tinkr_save_snippet: 'preference.mcp_tool_save_snippet',
  tinkr_delete_snippet: 'preference.mcp_tool_delete_snippet',
}

/**
 * The MCP section: which connection a client's code runs in, what a client may
 * do on a connection tagged production — the mode every one of them follows,
 * and each one's own override — one row per client the app can point at its own
 * server, and — for a client it does not know — the entry itself, with what the
 * server offers under it. Under all of it, the sessions clients had with the
 * server (McpSessions).
 *
 * A client that keeps its configuration in a file gets that file written; one
 * that keeps it behind a command of its own is given the command to copy. Both
 * are shown the file or the command they will get, because where a setting is
 * written is the thing worth knowing before pressing a button. A client that
 * already holds the entry says so with the outcome glyph, not with a badge: the
 * app says a thing landed the same way wherever it says it.
 */
const McpForm = () => {
  const intl = useIntl()
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(setConfigAtom)
  const mcp = useAtomValue(mcpAtom)
  const reload = useSetAtom(reloadMcpAtom)
  const configure = useSetAtom(configureClientAtom)
  const connections = useAtomValue(connectionListAtom)
  const updateConnection = useSetAtom(updateConnectionAtom)
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState('')
  const [written, setWritten] = useState({})
  // only a connection tagged production is gated, so only those have an access
  // of their own worth setting
  const gated = connections.filter(connection => connection.tag === 'production')

  const entry = JSON.stringify(mcp.config, null, 2)
  const copyLabel = copied ? 'preference.mcp_copied' : 'preference.mcp_copy'

  const copy = async (what, text) => {
    await navigator.clipboard.writeText(text)

    setCopied(what)
    setTimeout(() => setCopied(''), 1600)
  }

  const handleConnection = event => {
    setConfig({mcp_connection: event.target.value})
    // the entry names the connection, so what the section shows is what the
    // main process makes of the one just chosen
    reload()
  }

  // the access sits on the connection, so it is written the way the connection
  // dialog writes one: the store hands the whole connection to the main process,
  // which keeps the password it already had (see updateConnectionAtom)
  const handleAccess = (event, connection) => {
    updateConnection({...connection, mcp_access: event.target.value})
  }

  const handleConfigure = async client => {
    setBusy(client.id)

    try {
      await configure(client.id)

      setWritten(current => ({
        ...current,
        [client.id]: intl.formatMessage({id: 'preference.mcp_written'}, {client: client.name}),
      }))
    } catch (e) {
      setWritten(current => ({...current, [client.id]: e.message}))
    }

    setBusy('')
  }

  return (
    <>
      <div className='setting'>
        <div>
          <div className='setting__label'>
            {intl.formatMessage({id: 'preference.mcp_connection'})}
          </div>
          <div className='setting__desc'>
            {intl.formatMessage({id: 'preference.mcp_connection_description'})}
          </div>
        </div>

        <div className='setting__control'>
          <select
            className='select'
            value={config.mcp_connection || ''}
            aria-label={intl.formatMessage({id: 'preference.mcp_connection'})}
            onChange={handleConnection}
          >
            <option value=''>
              {intl.formatMessage({id: 'preference.mcp_connection_client'})}
            </option>
            {connections.map(connection => (
              <option
                key={connection.id}
                value={connection.id}
              >
                {connection.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SegmentedField
        labelId='preference.mcp_production'
        descriptionId='preference.mcp_production_description'
        configKey='mcp_production'
        options={productionOptions}
      />

      {gated.length > 0 && (
        <>
          <div className='setting'>
            <div>
              <div className='setting__label'>
                {intl.formatMessage({id: 'preference.mcp_access'})}
              </div>
              <div className='setting__desc'>
                {intl.formatMessage({id: 'preference.mcp_access_description'})}
              </div>
            </div>
          </div>

          {gated.map(connection => (
            <div
              className='setting'
              key={connection.id}
            >
              <div>
                <div className='setting__label'>{connection.name}</div>
                <div className='setting__desc'>
                  {intl.formatMessage({id: 'connections.tag_production'})}
                </div>
              </div>

              <div className='setting__control'>
                <select
                  className='select'
                  value={connection.mcp_access || ''}
                  aria-label={intl.formatMessage({id: 'preference.mcp_access_for'}, {connection: connection.name})}
                  onChange={event => handleAccess(event, connection)}
                >
                  {accessOptions.map(option => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {intl.formatMessage({id: option.labelId})}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </>
      )}

      {mcp.clients.map(client => (
        <div
          className='setting'
          key={client.id}
        >
          <div>
            <div className='setting__label'>{client.name}</div>
            <div className='setting__desc'>
              <span className='mono'>
                {client.kind === 'command' ? mcp.command : client.file}
              </span>
            </div>
            <div className='setting__desc'>
              {intl.formatMessage({
                id: client.kind === 'command'
                  ? 'preference.mcp_command_description'
                  : client.installed ? 'preference.mcp_found' : 'preference.mcp_not_found',
              })}
              {written[client.id] ? ` · ${written[client.id]}` : ''}
            </div>
          </div>

          <div className='setting__control'>
            {client.configured && (
              <Outcome
                kind='returned'
                label
                text={intl.formatMessage({id: 'preference.mcp_configured'})}
              />
            )}

            <button
              className='btn btn--secondary'
              type='button'
              disabled={busy === client.id}
              onClick={() => (client.kind === 'command'
                ? copy(client.id, mcp.command)
                : handleConfigure(client))}
            >
              {intl.formatMessage({
                id: client.kind === 'command'
                  ? copyLabel
                  : 'preference.mcp_configure',
              })}
            </button>
          </div>
        </div>
      ))}

      <div className='mcppane'>
        <div className='mcppane__head'>
          <span className='field__label'>
            {intl.formatMessage({id: 'preference.mcp_manual'})}
          </span>
          <span
            className='mono'
            title={mcp.server}
          >
            {mcp.server}
          </span>
          <button
            className='btn btn--secondary btn--sm'
            type='button'
            onClick={() => copy('entry', entry)}
          >
            {intl.formatMessage({id: copied === 'entry' ? 'preference.mcp_copied' : 'preference.mcp_copy'})}
          </button>
        </div>

        <div className='mcppane__note'>
          {intl.formatMessage({id: 'preference.mcp_manual_description'})}
        </div>

        <pre className='mcppane__body'>{entry}</pre>
      </div>

      <div className='mcppane'>
        <div className='mcppane__head'>
          <span className='field__label'>
            {intl.formatMessage({id: 'preference.mcp_tools'})}
          </span>
          <span className='grow'/>
          <span className='mono'>{mcp.tools.length}</span>
        </div>

        <div className='mcppane__body'>
          {mcp.tools.map(name => (
            <div
              className='mcppane__row'
              key={name}
            >
              <span className='mcppane__name mono'>{name}</span>
              {toolMessages[name] && (
                <span className='muted'>
                  {intl.formatMessage({id: toolMessages[name]})}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <McpSessions/>
    </>
  )
}

export default McpForm
