const {contextBridge, ipcRenderer} = require('electron')
const queryString = require('query-string')

const connectionId = () => queryString.parse(global.location.search).id

contextBridge.exposeInMainWorld('api', {
  selectDirectory: defaultPath => ipcRenderer.sendSync('selectDirectory', defaultPath),
  selectFile: defaultPath => ipcRenderer.sendSync('selectFile', defaultPath),
  setLocale: locale => ipcRenderer.send('setLocale', locale),
  getLocale: () => ipcRenderer.sendSync('getLocale'),
  allConfig: () => ipcRenderer.sendSync('allConfig'),
  setConfig: data => ipcRenderer.send('setConfig', data),
  allLocales: () => ipcRenderer.sendSync('allLocales'),
  getIntlConfig: () => ipcRenderer.send('getIntlConfig'),
  createConnection: connection => ipcRenderer.send('createConnection', connection),
  getConnection: () => ipcRenderer.sendSync('getConnection', connectionId()),
  deleteConnection: id => ipcRenderer.send('deleteConnection', id),
  allConnections: () => ipcRenderer.sendSync('allConnections'),
  updateConnection: connection => ipcRenderer.send('updateConnection', connection),
  connectConnection: connection => ipcRenderer.send('connectConnection', connection),
  reconnectConnection: connection => ipcRenderer.send('reconnectConnection', connection),
  quickConnect: () => ipcRenderer.send('quickConnect'),
  openPreference: () => ipcRenderer.send('openPreference'),
  popupConnectionContextMenu: id => ipcRenderer.send('popupConnectionContextMenu', id),
  inputConnection: code => ipcRenderer.send('inputConnection', connectionId(), code),
  runConnection: code => ipcRenderer.send('runConnection', connectionId(), code),
  closeConnection: () => ipcRenderer.send('closeConnection', connectionId()),

  aiProviders: () => ipcRenderer.sendSync('aiProviders'),
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
  allSnippets: () => ipcRenderer.sendSync('allSnippets', connectionId()),

  allHistory: () => ipcRenderer.sendSync('allHistory', connectionId()),
})
