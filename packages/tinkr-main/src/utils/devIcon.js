const path = require('path')
const {is} = require('electron-util')

/**
 * The mark a window wears while the app runs from a checkout.
 *
 * A packaged build needs nothing here: electron-builder reads
 * `directories.buildResources` (the repository's `assets/`) and writes the
 * platform's own entry, so the launcher and the window take `icon.icns` there.
 * In development there is no such entry, and the window would wear Electron's
 * own logo instead of the app's.
 *
 * @return {{icon?: String}} the option to spread into a BrowserWindow
 */
const devIcon = () => (is.development
  ? {icon: path.join(__dirname, '../../../../assets/icon.png')}
  : {})

module.exports = {
  devIcon,
}
