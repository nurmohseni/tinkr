const {app} = require('electron')
const path = require('path')
const {pathToFileURL} = require('url')
const {is} = require('electron-util')

const getEntryUrl = asset => {
  if (is.development) {
    return `http://localhost:${process.env.WEB_PORT || 8080}/${asset}`
  }

  // the renderer is read from disk, and a path is not a url: on windows it
  // carries backslashes and a drive letter. pathToFileURL is what turns one
  // into the other, on every platform, and it escapes what a url cannot hold
  // as it is.
  return pathToFileURL(path.join(app.getAppPath(), 'renderer', asset)).toString()
}

const getPreloadEntryUrl = () => {
  // a preload is a path, not a url, and electron takes it as one
  return path.join(__dirname, '../rendererPreload.js')
}

module.exports = {
  getEntryUrl,
  getPreloadEntryUrl,
}
