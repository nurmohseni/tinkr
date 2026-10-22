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

// what a connection's runs answered while the window was showing another one:
// the run was asked for, so its answer is the connection's until the window is
// back on it. It holds the answer, the history row that went with it, and what
// the run printed live — the pane's own stream, which has no window to go to
// while the connection is not on screen
const bufferedAnswers = {}

const getBufferedAnswer = id => bufferedAnswers[id]
const setBufferedAnswer = (id, value) => bufferedAnswers[id] = value
const clearBufferedAnswer = id => delete bufferedAnswers[id]

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

  clearBufferedAnswer(id)
}

// every session of the app, for the window that ran them going away: a run left
// mid-flight for a connection the window had moved off is still a php
const killEveryPty = () => {
  Object.keys(ptyProcesses).forEach(id => killPtys(id))
  Object.keys(backgroundPtyProcesses).forEach(id => killPtys(id))
  Object.keys(bufferedAnswers).forEach(id => clearBufferedAnswer(id))
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
  getBufferedAnswer,
  setBufferedAnswer,
  clearBufferedAnswer,
  killPtys,
  killEveryPty,
}
