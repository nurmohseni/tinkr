import {atom} from 'jotai'

import {runConnection, getConnection, reconnectConnection} from '../utils/api'
import {mutationScan} from '../utils/mutationScan'

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
// whether a run is sent inside a transaction it takes back when it is done. It
// is a switch the user keeps set, and it is read when the run is sent rather
// than stored with it, so turning it on changes the next run and not the last.
const dryRunAtom = atom(false)

// the run the pre-flight scan is holding back, with what the scan found in it:
// the code, the guard the run was being sent under, and the calls that write.
// Null whenever nothing is waiting to be answered.
const mutationGateAtom = atom(null)

/**
 * Run the code, optionally inside a transaction the run is sent under.
 *
 * `options.guard` is per run and it is what the run's own actions use: the pane
 * offers to run a dry run again and keep what it did, and that run is the same
 * code with `commit` instead of `rollback`. Without it the run is guarded by the
 * dry run switch, and a run with neither is sent the way it always was.
 *
 * The commit cannot be a second decision taken after the run: a run is a session
 * of its own, booted for the run and killed once it has answered, so the
 * transaction it was sent under is closed by the time the pane reads it. The
 * choice is made before the run and the outcome is read after it, which is why
 * keeping a dry run means running it again.
 *
 * A guarded run that cannot arm its transaction is sent nothing to evaluate, so
 * it changes nothing and reports the guard's own failure: see
 * runResult.guardArm for why refusing is the only honest answer there.
 *
 * A run that writes, sent to a connection tagged production, is asked about
 * rather than sent: the scan is what the question is built from, and the run
 * waits in mutationGateAtom until it is answered. Nothing is asked when the run
 * cannot lose anything — a dry run is taken back by the guard, a run that only
 * reads changes nothing, and a connection tagged anything else is a connection
 * someone can recover — and the run the question sends is the same run again
 * with the answer already given.
 *
 * 执行代码
 */
const runAtom = atom(null, (get, set, code, options) => {
  const guard = options && options.guard !== undefined
    ? options.guard
    : (get(dryRunAtom) ? 'rollback' : null)

  const connection = get(connectionAtom) || {}
  const writes = guard === 'rollback' || (options && options.confirmed) || connection.tag !== 'production'
    ? []
    : mutationScan(code)

  if (writes.length) {
    set(mutationGateAtom, {code, guard, writes})

    return
  }

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
  runConnection(code, guard)
})

/**
 * The answer that sends the run the gate is holding.
 *
 * The run goes through as the run it already was — the same code, and the guard
 * it was being sent under — and it says so, so that the scan does not ask the
 * same question again about a run that has just been answered. The gate is
 * cleared first: the held run is the only reason the question was on screen, and
 * a run that answers can be the only one it was asking about.
 */
const confirmMutationsAtom = atom(null, (get, set) => {
  const held = get(mutationGateAtom)

  set(mutationGateAtom, null)

  if (held) {
    set(runAtom, held.code, {guard: held.guard, confirmed: true})
  }
})

// the other answer: nothing is sent, and what the scan found is dropped with the
// question, since the run it was about is the run that did not happen
const dismissMutationsAtom = atom(null, (get, set) => {
  set(mutationGateAtom, null)
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
  dryRunAtom,
  mutationGateAtom,
  runAtom,
  confirmMutationsAtom,
  dismissMutationsAtom,
  reconnectAtom,
  appendOutputAtom,
  clearOutputAtom,
}
