const {app, Menu, shell} = require('electron')
const {
  is,
  appMenu,
} = require('electron-util')

const {config} = require('./database/config')
const {getIntl} = require('./locale')
const {createPreferenceWindow} = require('./createPreferenceWindow')
const {createEditorWindow} = require('./createEditorWindow')
const {firstConnection} = require('./services/connections')
const {getCurrentEditorWindow} = require('./processes')

const showPreferences = () => {
  createPreferenceWindow()
}

const debugSubmenu = [
  {
    label: getIntl().formatMessage({id: 'menu.show_settings'}),
    click() {
      config.openInEditor()
    },
  },
  {
    label: getIntl().formatMessage({id: 'menu.show_app_data'}),
    click() {
      return shell.openPath(app.getPath('userData'))
    },
  },
  {
    type: 'separator',
  },
  {
    label: getIntl().formatMessage({id: 'menu.delete_settings'}),
    click() {
      config.clear()
      app.relaunch()
      app.quit()
    },
  },
  {
    label: getIntl().formatMessage({id: 'menu.delete_app_data'}),
    click() {
      shell.moveItemToTrash(app.getPath('userData'))
      app.relaunch()
      app.quit()
    },
  },
]

const macosTemplate = [
  appMenu([
    {
      label: getIntl().formatMessage({id: 'menu.preferences'}),
      accelerator: 'Command+,',
      click() {
        showPreferences()
      },
    },
  ]),
  {
    role: 'fileMenu',
    submenu: [
      {
        role: 'close',
      },
    ],
  },
  {
    role: 'editMenu',
  },
  {
    role: 'viewMenu',
  },
  {
    role: 'windowMenu',
  },
]

// Linux and Windows
const otherTemplate = [
  {
    role: 'fileMenu',
    submenu: [
      {
        label: getIntl().formatMessage({id: 'menu.settings'}),
        accelerator: 'Control+,',
        click() {
          showPreferences()
        },
      },
      {
        type: 'separator',
      },
      {
        role: 'quit',
      },
    ],
  },
  {
    role: 'editMenu',
  },
  {
    role: 'viewMenu',
  },
]

const template = process.platform === 'darwin' ? macosTemplate : otherTemplate

if (is.development) {
  template.push({
    label: getIntl().formatMessage({id: 'menu.debug'}),
    submenu: debugSubmenu,
  })
}

const menu = Menu.buildFromTemplate(template)

const dockMenu = Menu.buildFromTemplate([
  {
    // the connections live in the editor window now, so the item brings that
    // window forward, and opens a connection's window when there is none
    label: getIntl().formatMessage({id: 'menu.show_connections'}),
    async click() {
      const win = getCurrentEditorWindow()

      if (win) {
        win.show()
        return
      }

      await createEditorWindow(firstConnection())
    },
  },
])

module.exports = {
  menu,
  dockMenu,
}
