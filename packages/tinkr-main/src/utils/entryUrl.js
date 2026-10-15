const path = require('path')
const {is} = require('electron-util')

const {rendererScheme} = require('../constants')

const getEntryUrl = asset => {
  if (is.development) {
    return `http://localhost:${process.env.WEB_PORT || 8080}/${asset}`
  }

  // the renderer is served over the app's own scheme rather than read from a
  // file:// url: a module script has no origin to load from there, which is
  // what kept the app's script from running on windows
  return `${rendererScheme}://tinkr/${asset}`
}

const getPreloadEntryUrl = () => {
  // a preload is a path, not a url, and electron takes it as one
  return path.join(__dirname, '../rendererPreload.js')
}

module.exports = {
  getEntryUrl,
  getPreloadEntryUrl,
}
