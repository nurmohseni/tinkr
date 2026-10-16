const fs = require('fs')
const {dialog, BrowserWindow} = require('electron')

const {appName} = require('../constants')
const {getIntl} = require('../locale')

/**
 * ask where to save a file and write it there.
 *
 * The write happens here rather than in the renderer, which cannot write a file
 * without a download: the dialog and the disk are the main process's, and the
 * renderer only says what to save.
 *
 * A save that was called off, and a write that failed, are both no file: the
 * caller gets an empty path either way, and a failure says so on the screen
 * rather than in a log the person saving the file never sees. This is called
 * over a synchronous channel, so it never throws: a throw here would leave the
 * renderer waiting for a reply that never comes.
 *
 * @param {string} defaultPath
 * @param {string} contents
 * @returns {string} the path it was saved to, or an empty string
 */
const saveFile = (defaultPath = '', contents = '') => {
  const path = dialog.showSaveDialogSync(BrowserWindow.getFocusedWindow(), {defaultPath})

  if (!path) {
    return ''
  }

  try {
    fs.writeFileSync(path, contents)
  } catch (error) {
    dialog.showErrorBox(
      appName,
      getIntl().formatMessage({id: 'result.save_failed'}, {message: error.message}),
    )

    return ''
  }

  return path
}

module.exports = {
  saveFile,
}
