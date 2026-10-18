const fs = require('fs')
const path = require('path')
const {app} = require('electron')
const Store = require('electron-store')
const log = require('electron-log')

/**
 * Where a store whose file could not be read puts that file.
 *
 * The name keeps the store's own name and says when it was set aside, so the
 * person who goes looking finds it beside the one that replaced it:
 * `connections.json` becomes `connections.corrupt-1760000000000.json`.
 *
 * @param {String} file
 * @return {String}
 */
const asideOf = file => {
  const extension = path.extname(file)

  return `${file.slice(0, file.length - extension.length)}.corrupt-${Date.now()}${extension}`
}

/**
 * Set a file the app cannot read out of its way.
 *
 * A file that is half written, or that another program wrote over, is still
 * somebody's connections or snippets: it is moved rather than deleted, and what
 * the app goes on with is the store's defaults.
 *
 * @param {String} file
 * @param {Error} error why it could not be read
 */
const setAside = (file, error) => {
  const aside = asideOf(file)

  try {
    fs.renameSync(file, aside)
    log.error(`[store] ${file} could not be read (${error.message}); it was moved to ${aside} and the defaults are used instead.`)
  } catch (e) {
    // a file that cannot be moved either is one the next read will find again,
    // and it is read as the defaults then too
    log.error(`[store] ${file} could not be read (${error.message}) nor moved aside (${e.message}).`)
  }
}

/**
 * A store of the app's, which survives its own file being unreadable.
 *
 * electron-store reads the file on every access and throws when it is not json
 * — at startup for the preferences and the connections, and inside every run
 * for a connection's history — so one bad byte would be an app that cannot
 * start or a run that cannot finish. What cannot be parsed is set aside and read
 * as empty, which is what the defaults are then laid over.
 *
 * electron-store writes through a temporary file and a rename already, so a
 * write that is cut off leaves the old file whole.
 *
 * @param {Object} options what electron-store takes; `name` is required
 * @return {Store}
 */
const openStore = options => {
  const cwd = options.cwd || app.getPath('userData')
  const file = path.resolve(cwd, `${options.name}.json`)

  return new Store(Object.assign({}, options, {
    cwd,
    deserialize: text => {
      try {
        const data = JSON.parse(text)

        // a store is an object of keys; anything else is not one of ours
        if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
          return data
        }

        throw new SyntaxError('it does not hold a JSON object')
      } catch (error) {
        setAside(file, error)

        return {}
      }
    },
  }))
}

module.exports = {
  openStore,
  asideOf,
}
