const {autoUpdater} = require('electron-updater')
const {BrowserWindow} = require('electron')
const log = require('electron-log')
const path = require('path')
const fs = require('fs')

autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'info'

// Nothing is downloaded or installed on its own: the app checks, and the two
// answers it asks for — download it, install it — are what make those happen.
// What a user agreed to is installed when the app closes, which is why the
// second answer is about *when*, not *whether*.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

/**
 * Tell the windows what the updater is doing, so the window can ask.
 *
 * @param {String} channel
 * @param {Record<String, any>} [payload]
 */
const tell = (channel, payload) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/**
 * Whether this build can replace itself at all.
 *
 * The updater reads app-update.yml from beside the app, and electron-builder
 * writes that only for the targets that can install over themselves. The
 * portable build extracts into a temporary directory every launch and the
 * squirrel setup installs into one of its own, so neither has one: checking
 * from them is an error on every launch and nothing else.
 *
 * @return {Boolean}
 */
const canUpdate = () => fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))

/**
 * Ask the releases whether there is something newer than this build, and say
 * what was found.
 *
 * It runs once as the app opens and every few hours after that, where the
 * answer is a line in the log, and it runs because the settings asked, where the
 * answer is the whole point: the window needs to know what happened, not just
 * that the question was asked. So it never says nothing — a build that cannot
 * replace itself says so, and a feed that cannot be read says what went wrong
 * rather than leaving a button looking like it did not work.
 *
 * The running version is not part of the answer: the window already prints the
 * app's version from its own build, and that is the number the person reads in
 * the title bar and the status bar.
 *
 * @return {Promise<{status: String, latest?: String, message?: String}>} `unavailable`
 *   when this build cannot update itself, `newest` when it is, `available` with
 *   the version that is out, and `failed` with the reason the check was not made
 */
const checkForUpdates = async () => {
  if (!canUpdate()) {
    log.info('[update] this build cannot install over itself, so nothing was asked')

    return {status: 'unavailable'}
  }

  log.info('[update] checking for a newer version')

  let found

  try {
    found = await autoUpdater.checkForUpdates()
  } catch (e) {
    log.warn('[update] could not check for a newer version:', e.message)

    return {status: 'failed', message: e.message}
  }

  // the updater answers nothing at all when it is not allowed to run, which is
  // what a build that was not installed from a release gets
  if (!found) {
    return {status: 'unavailable'}
  }

  if (!found.isUpdateAvailable) {
    return {status: 'newest'}
  }

  return {status: 'available', latest: found.updateInfo.version}
}

/** Download what the check found, because the window asked. */
const downloadUpdate = () => autoUpdater.downloadUpdate()

/** Install it and start again, because the window asked. */
const installUpdate = () => autoUpdater.quitAndInstall()

autoUpdater.on('update-available', info => {
  log.info('[update] a newer version is there:', info.version)
  tell('updateAvailable', {version: info.version})
})

autoUpdater.on('update-not-available', () => {
  log.info('[update] this is the newest version there is')
  tell('updateNotAvailable')
})

autoUpdater.on('download-progress', progress => {
  tell('updateProgress', {percent: Math.round(progress.percent)})
})

autoUpdater.on('update-downloaded', info => {
  log.info('[update] downloaded:', info.version)
  tell('updateDownloaded', {version: info.version})
})

autoUpdater.on('error', e => {
  log.warn('[update] something went wrong:', e.message)
  tell('updateFailed', {message: e.message})
})

module.exports = {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
}
