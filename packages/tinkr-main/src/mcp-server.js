/**
 * The MCP server, as the app ships it.
 *
 * A client starts a program, and this file is that program: the server's own
 * entry, built beside the main process's bundle so that a packaged app can hand
 * out a path that exists. Where a client is told it is lives in services/mcp.js.
 */
const {main} = require('tinkr-mcp/src/cli')

main()
