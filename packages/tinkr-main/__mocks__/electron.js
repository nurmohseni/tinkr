// the main process runs inside electron, where this is the real app object:
// under jest there is none, so the parts the modules read are stubbed
module.exports = {
  app: {
    getLocale: () => 'en',
    getPath: () => '/tmp',
    getAppPath: () => '/tmp',
    isPackaged: false,
    on: () => {},
  },
  ipcMain: {on: () => {}, handle: () => {}},
  BrowserWindow: class BrowserWindow {},
  Menu: {setApplicationMenu: () => {}},
}
