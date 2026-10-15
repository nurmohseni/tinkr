import {atom} from 'jotai'

import {configureMcp, mcpInfo} from '../utils/api'

/**
 * What the MCP section shows: where the app's own server is, the entry a client
 * is given, and the clients this machine has.
 *
 * The main process is what knows all of it — the server's path is where it was
 * built, and a client's own configuration is a file on disk — so the section
 * reads the answer rather than composing it. The one thing the window decides is
 * which connection a client's calls run in, and that changes what the entry says,
 * so the answer is read again after it is written.
 */
const mcpAtom = atom(mcpInfo())

const reloadMcpAtom = atom(null, (get, set) => {
  set(mcpAtom, mcpInfo())
})

/**
 * Point one client at the server. The write's own answer carries the clients as
 * they stand after it, so nothing has to be read twice.
 *
 * @return {String} the file that was written
 */
const configureClientAtom = atom(null, async (get, set, id) => {
  const {file, info} = await configureMcp(id)

  set(mcpAtom, info)

  return file
})

export {
  mcpAtom,
  reloadMcpAtom,
  configureClientAtom,
}
