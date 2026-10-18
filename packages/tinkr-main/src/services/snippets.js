const {withLock} = require('tinkr-mcp/src/files')

const {snippets} = require('../database/snippets')

/**
 * Change a connection's snippets under the lock the MCP server takes too.
 *
 * Both write the same file, and each write is a read of the whole file followed
 * by a write of it: without the lock, a snippet the server saved between the two
 * would be written over by the app's copy. The store reads the file inside the
 * change, so under the lock it reads what the other side last wrote.
 *
 * @param {String} connectionId
 * @param {Function} change what to do to the store
 */
const changeSnippets = (connectionId, change) => {
  const store = snippets(connectionId)

  withLock(store.path, () => change(store))
}

const createSnippet = (connectionId, snippet) => {
  changeSnippets(connectionId, store => store.set(snippet.id, snippet))
}

const updateSnippet = (connectionId, snippet) => {
  changeSnippets(connectionId, store => store.set(snippet.id, snippet))
}

const allSnippets = connectionId => {
  return snippets(connectionId).store
}

const deleteSnippet = (connectionId, snippetId) => {
  changeSnippets(connectionId, store => store.delete(snippetId))
}

module.exports = {
  createSnippet,
  updateSnippet,
  allSnippets,
  deleteSnippet,
}
