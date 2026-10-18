const {app, Menu, BrowserWindow} = require('electron')
const {is} = require('electron-util')
const unhandled = require('electron-unhandled')
const debug = require('electron-debug')
const contextMenu = require('electron-context-menu')

const {createEditorWindow} = require('./createEditorWindow')
const {firstConnection} = require('./services/connections')
const {menu, dockMenu} = require('./menu')
const {checkForUpdates} = require('./updater')
require('./ipc')
const {serveRenderer} = require('./protocol')

unhandled({
  showDialog: false,
})
debug({
  isEnabled: is.development,
  devToolsMode: 'undocked',
})
// The app draws its own right-click menus — connection rows, tabs, snippets,
// result rows, the code editor — so electron's generic one is not what should
// open on every other pixel. It offered "Select All" and "Inspect Element" over
// panes that have neither, and on windows and linux the menu bar is gone too,
// so it was the last piece of default chrome.
//
// What is kept is the one case it earns: a text field, where cut, copy and paste
// are what a right-click is for. Outside an editable field the menu is not shown
// at all; the app's own handlers call preventDefault and draw theirs.
contextMenu({
  shouldShowMenu: (event, props) => Boolean(props.isEditable),
})

if (!is.development) {
  setInterval(checkForUpdates, 1000 * 60 * 60 * 4)
  checkForUpdates()
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (!is.macos) {
    app.quit()
  }
})

app.on('activate', async () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length <= 0) {
    await createEditorWindow(firstConnection())
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  // a menu bar on windows and linux is a strip above the app's own titlebar
  // that says the same things twice — and the window is frameless there, so it
  // would be the only frame left. macOS keeps its menu: it is the application's
  // own menu there, in the system menu bar, not in the window
  Menu.setApplicationMenu(is.macos ? menu : null)

  if (is.macos) {
    app.dock.setMenu(dockMenu)
  }

  // the renderer is served over the app's own scheme, which has to be answered
  // before a window asks for it
  serveRenderer()

  // the app is the editor window of a connection, and there is always one
  await createEditorWindow(firstConnection())
})
