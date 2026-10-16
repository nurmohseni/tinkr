import {useState} from 'react'
import {useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import Outcome from '../Outcome'
import {configAtom, setConfigAtom} from '../../stores/config'
import {connectionListAtom} from '../../stores/connections'
import {configureClientAtom, mcpAtom, reloadMcpAtom} from '../../stores/mcp'

/**
 * What each tool the server offers does, in the app's own words. The names are
 * the server's, and a tool this does not know is listed as its name alone rather
 * than as a message the app does not have.
 */
const toolMessages = {
  tinkr_run_php: 'preference.mcp_tool_run_php',
  tinkr_run_php_over_ssh: 'preference.mcp_tool_run_php_over_ssh',
  tinkr_list_connections: 'preference.mcp_tool_list_connections',
  tinkr_list_snippets: 'preference.mcp_tool_list_snippets',
  tinkr_save_snippet: 'preference.mcp_tool_save_snippet',
}

/**
 * The MCP section: which connection a client's code runs in, one row per client
 * the app can point at its own server, and — for a client it does not know — the
 * entry itself, with what the server offers under it.
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
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState('')
  const [written, setWritten] = useState({})

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
    </>
  )
}

export default McpForm
