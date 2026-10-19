const {contextBridge, ipcRenderer} = require('electron')
const queryString = require('query-string')

// The connection this window runs. It is the one the window was opened with
// until the main process says otherwise: switching a connection is a fact about
// the window, not about its url, and the window is not loaded again for it.
let currentConnectionId = queryString.parse(global.location.search).id

ipcRenderer.on('setConnection', (event, id) => {
  currentConnectionId = id
})

const connectionId = () => currentConnectionId

// what electron puts in front of the message of an error a handler threw, which
// is about the plumbing and not about what went wrong
const remotePrefix = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/

/**
 * Ask the main process, and fail with its own words when it fails.
 *
 * @param {String} channel
 * @param {...any} args
 * @return {Promise<any>}
 */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch(error => {
  throw new Error(String((error && error.message) || error).replace(remotePrefix, ''))
})

contextBridge.exposeInMainWorld('api', {
  selectDirectory: defaultPath => ipcRenderer.sendSync('selectDirectory', defaultPath),
  selectFile: defaultPath => ipcRenderer.sendSync('selectFile', defaultPath),
  saveFile: (defaultPath, contents) => ipcRenderer.sendSync('saveFile', defaultPath, contents),
  setLocale: locale => ipcRenderer.send('setLocale', locale),
  getLocale: () => ipcRenderer.sendSync('getLocale'),
  allConfig: () => ipcRenderer.sendSync('allConfig'),
  setConfig: data => ipcRenderer.send('setConfig', data),
  allLocales: () => ipcRenderer.sendSync('allLocales'),
  getIntlConfig: () => ipcRenderer.send('getIntlConfig'),
  checkForUpdates: () => ipcRenderer.send('checkForUpdates'),
  downloadUpdate: () => ipcRenderer.send('downloadUpdate'),
  installUpdate: () => ipcRenderer.send('installUpdate'),
  onPhpVersion: cb => {
    const listener = (event, payload) => cb(payload)
    ipcRenderer.on('phpVersion', listener)
    return {
      dispose: () => ipcRenderer.off('phpVersion', listener),
    }
  },

  onUpdateState: channel => cb => {
    const listener = (event, payload) => cb(payload)
    ipcRenderer.on(channel, listener)
    return {
      dispose: () => ipcRenderer.off(channel, listener),
    }
  },
  createConnection: connection => ipcRenderer.send('createConnection', connection),
  getConnection: () => ipcRenderer.sendSync('getConnection', connectionId()),
  deleteConnection: id => ipcRenderer.send('deleteConnection', id),
  allConnections: () => ipcRenderer.sendSync('allConnections'),
  updateConnection: connection => ipcRenderer.send('updateConnection', connection),
  forgetPassword: id => ipcRenderer.send('forgetPassword', id),
  // what an engine is running, and where the projects inside it are: a container
  // named per deploy cannot be typed, and neither can its path
  listContainers: connection => ipcRenderer.invoke('listContainers', connection),
  listProjectDirs: connection => ipcRenderer.invoke('listProjectDirs', connection),
  connectConnection: connection => ipcRenderer.send('connectConnection', connection),
  reconnectConnection: connection => ipcRenderer.send('reconnectConnection', connection),
  quickConnect: () => ipcRenderer.send('quickConnect'),
  openPreference: () => ipcRenderer.send('openPreference'),
  openLogs: () => ipcRenderer.send('openLogs'),
  logFiles: () => invoke('logFiles', connectionId()),
  logRead: (name, options) => invoke('logRead', connectionId(), name, options),
  mcpInfo: () => ipcRenderer.sendSync('mcpInfo'),
  configureMcp: id => invoke('configureMcp', id),
  popupConnectionContextMenu: id => ipcRenderer.send('popupConnectionContextMenu', id),
  inputConnection: code => ipcRenderer.send('inputConnection', connectionId(), code),
  runConnection: (code, guard) => ipcRenderer.send('runConnection', connectionId(), code, guard),
  // stop the run that is going: the session is killed, which stops the php the
  // run is doing, wherever the connection runs it
  stopConnection: () => ipcRenderer.send('stopConnection', connectionId()),
  closeConnection: () => ipcRenderer.send('closeConnection', connectionId()),

  // the frame is the app's own on windows and linux, so the controls are asked
  // for here: the window a message came from is the one they act on
  windowControl: control => ipcRenderer.send('windowControl', control),
  windowState: () => ipcRenderer.invoke('windowState'),
  onWindowState: cb => {
    const listener = (event, state) => cb(state)

    ipcRenderer.on('windowState', listener)

    return {dispose: () => ipcRenderer.off('windowState', listener)}
  },

  aiProviders: () => ipcRenderer.sendSync('aiProviders'),
  aiComplete: code => invoke('aiComplete', code),
  aiAsk: request => invoke('aiAsk', connectionId(), request),
  aiFiles: typed => invoke('aiFiles', connectionId(), typed),
  aiCheck: () => invoke('aiCheck'),

  parsePhpForm: code => invoke('parsePhpForm', connectionId(), code),
  stringifyPhpForm: (fields, code) => invoke('stringifyPhpForm', fields, code),
  phpCompletions: request => invoke('phpCompletions', connectionId(), request),

  onSetIntlConfig: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('setIntlConfig', listener)
    return {
      dispose: () => ipcRenderer.off('setIntlConfig', listener),
    }
  },

  onSetConfig: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('setConfig', listener)
    return {
      dispose: () => ipcRenderer.off('setConfig', listener),
    }
  },

  onOutputConnection: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('outputConnection', listener)
    return {
      dispose: () => ipcRenderer.off('outputConnection', listener),
    }
  },

  onRunOutput: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('runOutput', listener)
    return {
      dispose: () => ipcRenderer.off('runOutput', listener),
    }
  },

  onSessionState: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('sessionState', listener)
    return {
      dispose: () => ipcRenderer.off('sessionState', listener),
    }
  },

  onSetConnection: cb => {
    const listener = (event, id) => cb(id)
    ipcRenderer.on('setConnection', listener)
    return {
      dispose: () => ipcRenderer.off('setConnection', listener),
    }
  },

  onRunResult: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('runResult', listener)
    return {
      dispose: () => ipcRenderer.off('runResult', listener),
    }
  },

  onSnippetsConnection: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('snippetsConnection', listener)
    return {
      dispose: () => ipcRenderer.off('snippetsConnection', listener),
    }
  },

  onHistoryConnection: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('historyConnection', listener)
    return {
      dispose: () => ipcRenderer.off('historyConnection', listener),
    }
  },

  onDeleteConnectionConfirm: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('deleteConnectionConfirm', listener)
    return {
      dispose: () => ipcRenderer.off('deleteConnectionConfirm', listener),
    }
  },

  onReconnectConnection: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('reconnectConnection', listener)
    return {
      dispose: () => ipcRenderer.off('reconnectConnection', listener),
    }
  },

  onCloneConnection: cb => {
    const listener = (event, arg) => cb(arg)
    ipcRenderer.on('cloneConnection', listener)
    return {
      dispose: () => ipcRenderer.off('cloneConnection', listener),
    }
  },

  createSnippet: snippet => ipcRenderer.send('createSnippet', connectionId(), snippet),
  updateSnippet: snippet => ipcRenderer.send('updateSnippet', connectionId(), snippet),
  deleteSnippet: id => ipcRenderer.send('deleteSnippet', connectionId(), id),
  allSnippets: () => ipcRenderer.sendSync('allSnippets', connectionId()),

  allHistory: () => ipcRenderer.sendSync('allHistory', connectionId()),
  clearHistory: () => ipcRenderer.sendSync('clearHistory', connectionId()),
})
