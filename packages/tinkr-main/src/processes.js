/* eslint no-return-assign: "off" */
const editorWindows = {}
const editorConnections = {}
const ptyProcesses = {}
const backgroundPtyProcesses = {}

const getEditorWindow = id => editorWindows[id]
const setEditorWindow = (id, win) => editorWindows[id] = win

// the app keeps one editor window, so it is looked up by what runs in it: the
// window that is open, and the connection a given window is showing
const getCurrentEditorWindow = () => Object.values(editorWindows).find(win => win !== null)
const getEditorConnectionId = win => Object.keys(editorWindows).find(id => editorWindows[id] === win)

// the connection an editor window runs, kept so a session can be booted again
const getEditorConnection = id => editorConnections[id]
const setEditorConnection = (id, connection) => editorConnections[id] = connection

const getPtyProcess = id => ptyProcesses[id]
const setPtyProcess = (id, process) => ptyProcesses[id] = process

const getBackgroundPtyProcess = id => backgroundPtyProcesses[id]
const setBackgroundPtyProcess = (id, process) => backgroundPtyProcesses[id] = process

// the sessions of a connection, cleared together: nothing of a connection that
// the app is not showing any more keeps running
const killPtys = id => {
  const pty = getPtyProcess(id)

  if (pty) {
    pty.kill()
    setPtyProcess(id, null)
  }

  const backgroundPty = getBackgroundPtyProcess(id)

  if (backgroundPty) {
    backgroundPty.kill()
    setBackgroundPtyProcess(id, null)
  }
}

module.exports = {
  getEditorWindow,
  setEditorWindow,
  getCurrentEditorWindow,
  getEditorConnectionId,
  getEditorConnection,
  setEditorConnection,
  getPtyProcess,
  setPtyProcess,
  getBackgroundPtyProcess,
  setBackgroundPtyProcess,
  killPtys,
}
