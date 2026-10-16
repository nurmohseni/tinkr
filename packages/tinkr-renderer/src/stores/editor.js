import {atom} from 'jotai'

import {runConnection, getConnection, reconnectConnection} from '../utils/api'

const connectionAtom = atom(getConnection())
const sizesAtom = atom([])
const outputAtom = atom('')
const outputTabIndexAtom = atom(1)
// what the result of the last run is read as: the tree of its value, or the text
// that value is drawn from. The last choice is kept, and it is what the run
// after it opens in.
const outputViewAtom = atom('organized')
const resultAtom = atom(null)
// the code the ai panel asked the editor to take. The editor is what holds the
// model, so the panel cannot write into it: it asks, and the editor takes what
// was asked of the document it is showing.
const applyCodeAtom = atom(null)
// the code the last run handed the session, which is what a tab's dot compares
// the editor against
const runCodeAtom = atom('')

// 执行代码
const runAtom = atom(null, (get, set, code) => {
  if (get(outputTabIndexAtom) !== 1) {
    // 展示 output
    set(outputTabIndexAtom, 1)
  }

  set(outputAtom, '')
  set(resultAtom, null)
  set(runCodeAtom, code)

  // the code is sent as it is: the main process base64 encodes it before the
  // session evals it, so newlines need no escaping, and rewriting them broke
  // the snippet with a parse error
  // PHP keeps in memory the classes it already loaded, so the code runs in a
  // brand new session and picks up whatever changed on disk
  runConnection(code)
})

// 重新连接
const reconnectAtom = atom(null, (get, set, code) => {
  if (get(outputTabIndexAtom) !== 0) {
    // 展示 output
    set(outputTabIndexAtom, 0)
  }

  set(outputAtom, '')

  const connection = get(connectionAtom)

  reconnectConnection(connection)
})

// 增加 output 数据
const appendOutputAtom = atom(null, (get, set, update) => {
  set(outputAtom, prev => `${prev}${update}`)
})

// 清空 output
const clearOutputAtom = atom(null, (get, set, update) => {
  set(outputAtom, '')
})

export {
  connectionAtom,
  sizesAtom,
  outputAtom,
  outputTabIndexAtom,
  outputViewAtom,
  resultAtom,
  applyCodeAtom,
  runCodeAtom,
  runAtom,
  reconnectAtom,
  appendOutputAtom,
  clearOutputAtom,
}
