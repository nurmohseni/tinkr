const {app} = require('electron')

/**
 * Where the app keeps its own files — the stores, and the secrets file a
 * connection's password and the Laravel Cloud token are kept in.
 *
 * It is asked for rather than passed down: every caller is a question about
 * what the app knows, and a question is not a place to thread a directory
 * through. A process that has no electron under it — a test — has no directory,
 * and everything that reads the secrets already treats that as "nothing saved".
 *
 * @return {String|null}
 */
const dataDir = () => {
  try {
    return app.getPath('userData')
  } catch (e) {
    return null
  }
}

module.exports = {dataDir}
