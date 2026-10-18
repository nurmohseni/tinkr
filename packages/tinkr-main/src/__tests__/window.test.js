// the app's own frame is drawn by the window, not by the platform: what the
// helper answers is what electron is given, and it is not asked for a BrowserWindow

const {frameOf, drawsControls} = require('../utils/frame')

describe('the window frame', () => {
  test('is the app\'s own on every platform, and keeps what each one needs', () => {
    const platform = process.platform

    try {
      // linux and windows: no frame at all, because the design's titlebar is
      // the frame and the platform's would be a second one
      Object.defineProperty(process, 'platform', {value: 'linux'})
      expect(frameOf()).toEqual({frame: false})
      expect(drawsControls()).toBe(true)

      Object.defineProperty(process, 'platform', {value: 'win32'})
      expect(frameOf()).toEqual({frame: false})
      expect(drawsControls()).toBe(true)

      // macOS: hidden, not removed — the traffic lights stay, inset into the
      // app's own titlebar, and the renderer draws no second set
      Object.defineProperty(process, 'platform', {value: 'darwin'})
      expect(frameOf()).toEqual({
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: {x: 12, y: 11},
      })
      expect(drawsControls()).toBe(false)
    } finally {
      Object.defineProperty(process, 'platform', {value: platform})
    }
  })
})
