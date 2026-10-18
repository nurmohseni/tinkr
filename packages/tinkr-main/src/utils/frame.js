/**
 * The window frame, or the absence of one.
 *
 * The app draws its own titlebar — the brand, the connection, the controls — so
 * the platform's frame would be a second one above it, and on Windows and Linux
 * a menu bar a third. The design's titlebar is already the drag region, and the
 * CSS there asks for a frameless window without ever having one.
 *
 * What a frameless window still keeps, and wants to:
 *
 * - the resize edges and the drop shadow, which `frame: false` keeps on Windows
 *   and Linux and loses on macOS, where `titleBarStyle: 'hidden'` is the way to
 *   keep them;
 * - the traffic lights on macOS, inset so they sit in the titlebar rather than
 *   above it. They are the platform's own controls, in the platform's own place,
 *   because a Mac user's muscle memory is not the app's to rewrite.
 *
 * Windows and Linux get no platform controls at all: the renderer draws them,
 * because that is where they can be styled like the rest of the app.
 *
 * @return {Object} what a BrowserWindow takes
 */
const frameOf = () => {
  if (process.platform === 'darwin') {
    return {
      // the titlebar is the app's, but the traffic lights stay: inset where the
      // titlebar's own padding puts them
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: {x: 12, y: 11},
    }
  }

  return {frame: false}
}

/**
 * Whether the renderer draws the window controls.
 *
 * On macOS the traffic lights are the platform's, so drawing a second set would
 * be two ways to close one window.
 *
 * @return {Boolean}
 */
const drawsControls = () => process.platform !== 'darwin'

module.exports = {
  frameOf,
  drawsControls,
}
