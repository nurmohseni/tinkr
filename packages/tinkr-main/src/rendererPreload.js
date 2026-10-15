const {contextBridge, ipcRenderer} = require('electron')
const queryString = require('query-string')

// The connection this window runs. It is the one the window was opened with
// until the main process says otherwise: switching a connection is a fact about
// the window, not about its url, and the window is not loaded again for it.
let currentConnectionId = queryString.parse(global.location.search).id

// Every question the window asks the main process with is a synchronous one, so
// one that is never answered stops the window dead. Each is announced here, which
// is how the one that stopped it is named.
const sync = (channel, ...args) => {
  console.log('[preload] asking', channel)

  const answer = ipcRenderer.sendSync(channel, ...args)

  console.log('[preload]', channel, 'was answered')

  return answer
}

ipcRenderer.on('setConnection', (event, id) => {
  currentConnectionId = id
})

const connectionId = () => currentConnectionId

contextBridge.exposeInMainWorld('api', {
  selectDirectory: defaultPath => sync('selectDirectory', defaultPath),
  selectFile: defaultPath => sync('selectFile', defaultPath),
  setLocale: locale => ipcRenderer.send('setLocale', locale),
  getLocale: () => sync('getLocale'),
  allConfig: () => sync('allConfig'),
  setConfig: data => ipcRenderer.send('setConfig', data),
  allLocales: () => sync('allLocales'),
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
  getConnection: () => sync('getConnection', connectionId()),
  deleteConnection: id => ipcRenderer.send('deleteConnection', id),
  allConnections: () => sync('allConnections'),
  updateConnection: connection => ipcRenderer.send('updateConnection', connection),
  connectConnection: connection => ipcRenderer.send('connectConnection', connection),
  reconnectConnection: connection => ipcRenderer.send('reconnectConnection', connection),
  quickConnect: () => ipcRenderer.send('quickConnect'),
  openPreference: () => ipcRenderer.send('openPreference'),
  popupConnectionContextMenu: id => ipcRenderer.send('popupConnectionContextMenu', id),
  inputConnection: code => ipcRenderer.send('inputConnection', connectionId(), code),
  runConnection: code => ipcRenderer.send('runConnection', connectionId(), code),
  closeConnection: () => ipcRenderer.send('closeConnection', connectionId()),

  aiProviders: () => sync('aiProviders'),
  aiComplete: code => ipcRenderer.invoke('aiComplete', code),
  aiAsk: request => ipcRenderer.invoke('aiAsk', request),
  aiCheck: () => ipcRenderer.invoke('aiCheck'),

  parsePhpForm: code => ipcRenderer.invoke('parsePhpForm', connectionId(), code),
  stringifyPhpForm: fields => ipcRenderer.invoke('stringifyPhpForm', fields),
  phpCompletions: request => ipcRenderer.invoke('phpCompletions', connectionId(), request),

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
  allSnippets: () => sync('allSnippets', connectionId()),

  allHistory: () => sync('allHistory', connectionId()),
  clearHistory: () => sync('clearHistory', connectionId()),
})
