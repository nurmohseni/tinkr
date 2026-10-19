import {atom} from 'jotai'

import {runConnection, stopConnection, getConnection, reconnectConnection} from '../utils/api'
import {mutationScan, unguardableScan} from '../utils/mutationScan'

const connectionAtom = atom(getConnection())
const sizesAtom = atom([])

// which view of the output panel is on: the run's own output, the queries, the
// terminal, the ai panel. It is the panel's, not a document's — the panel is one
// pane and the view in it is a way of reading, so switching tabs keeps the view
// the person chose
const outputTabIndexAtom = atom(1)

// what a run's value is read as: the tree, or the text it is drawn from. That is
// a way of reading rather than a fact about a run, so it is the window's too, and
// a run that lands is read the way the last one was
const outputViewAtom = atom('organized')

// the code the ai panel asked the editor to take. The editor is what holds the
// model, so the panel cannot write into it: it asks, and the editor takes what
// was asked of the document it is showing.
const applyCodeAtom = atom(null)

/**
 * Every document's run, by the document it is of.
 *
 * A run belongs to the document that sent it, not to the window: a window with
 * three tabs open is three snippets, and a run in each is three answers. Held
 * here rather than as one window-wide value, a run that has answered stays with
 * its tab while another tab is read and another run is sent — which is what a
 * tab is for.
 *
 * A record is `{result, output, code, gate}`:
 *
 * - `result` is the envelope the main process answered with, or null;
 * - `output` is what the run printed, as it printed it;
 * - `code` is the code the run was sent with, which is what a tab's dot compares
 *   the editor against;
 * - `gate` is the pre-flight question a run that writes is waiting behind.
 *
 * What a record is not is whether a run is going: a connection has one session,
 * so the window has one run at a time, and that is the window's to say (see
 * `inFlightAtom`). A second run anywhere ends the first, which is the way it has
 * always been, and a tab whose answer is landing is not distinguishable from one
 * that is waiting — there is only ever one of either.
 *
 * A document that has run nothing has no record at all, and reads as the empty
 * one.
 */
const runsAtom = atom({})

/**
 * The run that is going, if one is: the document it is of, and when it was sent.
 *
 * One at a time, because a run is a session of the connection and a connection
 * has one — a second run kills the first. Held here rather than in a record so
 * that a run sent from one tab is still the window's one run after the person
 * has moved to another tab, and so that stopping it stops the one that is
 * actually going.
 */
const inFlightAtom = atom(null)

// the document whose run is on screen, which is the document the window is on.
// It is a field rather than a hook so that the atoms below can read it: the
// components that show a run do not have to say which document they are on
const activeDocumentAtom = atom(null)

/**
 * The empty record, which is what a document that has run nothing reads as.
 *
 * Every field a record has is here, so a partial record is never a field that is
 * missing: a document with no run is one with nothing to show, not one with an
 * `undefined` in the pane.
 */
const emptyRun = {
  result: null,
  output: '',
  code: '',
  gate: null,
}

/**
 * The record of a document's run, or the empty one a document that has run
 * nothing reads as.
 *
 * @param {String|null} id
 * @return {Atom}
 */
const runOfAtom = id => atom(get => get(runsAtom)[id] || emptyRun)

/**
 * A field of the record of the document on screen.
 *
 * The pane, the button and the status bar all read the document they are on, so
 * this is what they read: one atom per field, derived from the record of the
 * document the window is on.
 *
 * @param {String} field
 * @return {Atom}
 */
const currentRunField = field => atom(get => {
  const record = get(runsAtom)[get(activeDocumentAtom)]

  return record ? record[field] : emptyRun[field]
})

const currentResultAtom = currentRunField('result')
const currentOutputAtom = currentRunField('output')
const currentRunCodeAtom = currentRunField('code')
const mutationGateAtom = currentRunField('gate')

// a run that is going, which is the window's: the button is a stop wherever the
// person has moved to, because the second run they could start would end the
// first one anyway
const runningAtom = atom(get => get(inFlightAtom) !== null)
const runStartedAtAtom = atom(get => get(inFlightAtom)?.startedAt ?? null)

// the document the answer that is coming belongs to: the one that sent the run
// that is going
const inFlightDocumentAtom = atom(get => get(inFlightAtom)?.document ?? null)

/**
 * A change of one document's record, keeping the others'.
 *
 * A record is replaced whole rather than merged: each write here is what the
 * run of that document is after it, and a merge would keep a `gate` that a run
 * has already answered past. The empty one a document starts with is the shape
 * every field reads as, so a partial record is never a document with no record.
 *
 * Each write is an atom of its own, so it can be written from a component and
 * from another atom alike — a run is sent by the button, by the editor's
 * shortcut and by the form, and the answers that follow it are written by the
 * window.
 *
 * @param {Function} change
 * @return {Atom} one that takes `{document, value}`
 */
const runWrite = change => atom(null, (get, set, {document, value}) => {
  if (document === null || document === undefined) {
    return
  }

  const current = get(runsAtom)[document] || emptyRun

  set(runsAtom, Object.assign({}, get(runsAtom), {[document]: change(current, value)}))
})

// the run a document's record is, as it is being sent
const setRun = runWrite((current, value) => Object.assign({}, emptyRun, value))

// the question a run that writes is held behind
const setGate = runWrite((current, value) => Object.assign({}, current, {gate: value}))

// the answer to a run: what came back, and no question waiting behind it
const setAnswer = runWrite((current, value) => Object.assign({}, current, {
  result: value,
  gate: null,
}))

// what the run printed, as it prints it
const appendToOutput = runWrite((current, value) => Object.assign({}, current, {
  output: `${current.output}${value}`,
}))
// whether a run is sent inside a transaction it takes back when it is done. It
// is a switch the user keeps set, and it is read when the run is sent rather
// than stored with it, so turning it on changes the next run and not the last.
const dryRunAtom = atom(false)

// what a dry run does with the world outside the database. A dry run takes the
// transaction back, and a sandboxed one also swaps the mailer, the queues, the
// http client, the disks, the cache and the log for recorders — so a run that
// "changed nothing" cannot have sent an email or called an API either. It is a
// separate switch because it changes what the code sees while it runs, and a
// run that inspects the mailer is not the run that would happen
const sandboxAtom = atom(true)

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
 * waits in mutationGateAtom until it is answered. A dry run is asked about only
 * for what its transaction cannot take back — DDL that MySQL commits on its own,
 * the snippet's own commit or rollback, another connection, a reconnect, the
 * default connection swapped — since everything else it does is undone. A run
 * that only reads and a connection tagged anything else ask nothing, and the run
 * the question sends is the same run again with the answer already given.
 *
 * 执行代码
 */
const runAtom = atom(null, (get, set, code, options) => {
  // what the run is guarded with: a dry run is a rollback, and a sandboxed dry
  // run is the same transaction with the side-effect drivers swapped
  const guard = options && options.guard !== undefined
    ? options.guard
    : (get(dryRunAtom) ? (get(sandboxAtom) ? 'sandbox' : 'rollback') : null)

  const connection = get(connectionAtom) || {}
  const asked = !(options && options.confirmed) && connection.tag === 'production'
  const unguardable = asked && (guard === 'rollback' || guard === 'sandbox')
  let writes = []

  if (unguardable) {
    writes = unguardableScan(code)
  } else if (asked) {
    writes = mutationScan(code)
  }

  // the document the run is of: the one on screen when it is sent. A run belongs
  // to its tab, and the tab it belongs to is the one that was being read
  const document = options && options.document !== undefined ? options.document : get(activeDocumentAtom)

  if (writes.length) {
    set(setGate, {document, value: unguardable ? {code, guard, writes, unguardable} : {code, guard, writes}})

    return
  }

  if (get(outputTabIndexAtom) !== 1) {
    // 展示 output
    set(outputTabIndexAtom, 1)
  }

  set(setRun, {
    document,
    value: {
      result: null,
      output: '',
      code,
      gate: null,
    },
  })

  set(inFlightAtom, {document, startedAt: Date.now()})

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
  // the question belongs to the document that is on screen: it was asked about
  // that document's run, and the run it sends is that document's too
  const document = get(activeDocumentAtom)
  const held = get(runsAtom)[document]?.gate

  set(setGate, {document, value: null})

  if (held) {
    set(runAtom, held.code, {guard: held.guard, confirmed: true, document})
  }
})

// the other answer: nothing is sent, and what the scan found is dropped with the
// question, since the run it was about is the run that did not happen
const dismissMutationsAtom = atom(null, (get, set) => {
  set(setGate, {document: get(activeDocumentAtom), value: null})
})

/**
 * Stop the run that is going.
 *
 * The stop ends the session the run is in, which is what reaches the php doing
 * the work — a run is a session of its own, and the next run boots its own, so
 * a stopped run costs nothing but the answer it will not give. What is in the
 * pane stays as it was: the run did not answer, and pretending it did would be
 * worse than an empty pane.
 */
const stopRunAtom = atom(null, (get, set) => {
  if (!get(inFlightAtom)) {
    return
  }

  set(inFlightAtom, null)
  stopConnection()
})

/**
 * The run's answer arrived, by whatever path: nothing is going any more.
 *
 * The answer itself is written by the window, which is what hears it from the
 * main process (see EditorWindow): this is the part that is true whichever way
 * it came, and it is the document the answer is of that is settled.
 */
const settledRunAtom = atom(null, (get, set) => {
  set(inFlightAtom, null)
})

// 重新连接
const reconnectAtom = atom(null, (get, set, code) => {
  if (get(outputTabIndexAtom) !== 0) {
    // 展示 output
    set(outputTabIndexAtom, 0)
  }

  // the terminal is the connection's session, and reconnecting starts a new one:
  // what the run printed into the old one is not this session's output
  set(appendToOutput, {document: get(activeDocumentAtom), value: ''})

  const connection = get(connectionAtom)

  reconnectConnection(connection)
})

// 增加 output 数据
const appendOutputAtom = atom(null, (get, set, update) => {
  set(appendToOutput, {document: get(activeDocumentAtom), value: update})
})

// 清空 output
const clearOutputAtom = atom(null, (get, set) => {
  set(setRun, {document: get(activeDocumentAtom), value: emptyRun})
})

export {
  connectionAtom,
  sizesAtom,
  // the run of a document, and the document whose run is on screen: a tab keeps
  // its own answer, and these are what the pane, the button and the status bar
  // read
  runsAtom,
  activeDocumentAtom,
  inFlightAtom,
  inFlightDocumentAtom,
  runOfAtom,
  setRun,
  setGate,
  setAnswer,
  currentResultAtom,
  currentOutputAtom,
  currentRunCodeAtom,
  outputTabIndexAtom,
  outputViewAtom,
  applyCodeAtom,
  dryRunAtom,
  sandboxAtom,
  runningAtom,
  runStartedAtAtom,
  stopRunAtom,
  settledRunAtom,
  mutationGateAtom,
  runAtom,
  confirmMutationsAtom,
  dismissMutationsAtom,
  reconnectAtom,
  appendOutputAtom,
  clearOutputAtom,
}
