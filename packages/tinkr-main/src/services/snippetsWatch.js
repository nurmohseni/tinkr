const fs = require('fs')
const path = require('path')
const {app} = require('electron')

/**
 * The snippets a connection has, watched so a change made outside the app is
 * shown without a restart.
 *
 * The app's own writes update the window they happen in, and the window is the
 * only one that writes — except the MCP server, which is a separate process
 * with the same file (see tinkr-mcp's app.saveSnippet). An agent that saves or
 * deletes a snippet writes that file from out there, and a window that only read
 * it when it switched connection would keep showing the snippets it had until it
 * was closed and opened again. So the file is watched, and what it holds is sent
 * to the window whenever it changes.
 *
 * The watch is on the directory rather than the file: the app and the server
 * both write through a temporary file and a rename (see files.writeAtomic), so
 * the file the watch was put on is replaced by another one on every write, and a
 * watch on the old inode would never hear about it again. A directory watch
 * hears the rename, and the name is what says whether it was this file.
 *
 * @param {Electron.BrowserWindow} win the window to push to
 * @param {String} connectionId
 * @param {Function} read what the snippets of the connection are right now
 * @return {{file: String, close: Function}|null} the watcher, or null when the
 *   file's directory is not there
 */
const watchSnippets = (win, connectionId, read) => {
  // the same file the MCP server writes: electron-store's `app/snippets/<id>`,
  // under the app's own data directory
  const file = path.join(app.getPath('userData'), 'app', 'snippets', `${connectionId}.json`)
  const directory = path.dirname(file)

  try {
    fs.mkdirSync(directory, {recursive: true})
  } catch (e) {
    return null
  }

  // what the window is showing, so a write that changes nothing does not redraw
  // it: the app's own save writes the file the window already read, and the
  // watcher hears that write like any other. It starts as what the file holds
  // now, because that is what the window read when it switched to the connection
  let sent = null

  try {
    sent = JSON.stringify(read())
  } catch (e) {
    // a file that cannot be read yet is one no write can be compared against:
    // the first change is sent whatever it says
  }

  const push = () => {
    if (!win || win.isDestroyed()) {
      return
    }

    let next = null

    try {
      next = read()
    } catch (e) {
      return
    }

    const json = JSON.stringify(next)

    if (json === sent) {
      return
    }

    sent = json
    win.webContents.send('snippetsConnection', {connection: connectionId, snippets: next})
  }

  // a watcher hears its own write, and the two writes of one save — the
  // temporary file and the rename — arrive a moment apart. A short debounce
  // reads the file once, after it has settled
  let timer = null
  const heard = (event, name) => {
    if (name && name !== path.basename(file) && !/\.tmp$|\.tinkr-/.test(String(name))) {
      return
    }

    clearTimeout(timer)
    timer = setTimeout(push, 60)
  }

  let watcher = null

  try {
    watcher = fs.watch(directory, heard)
  } catch (e) {
    return null
  }

  return {
    file,
    close: () => {
      clearTimeout(timer)
      watcher.close()
    },
  }
}

module.exports = {
  watchSnippets,
}
