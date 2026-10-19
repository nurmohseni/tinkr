import {createStore} from 'jotai'

import {confirmMutationsAtom, connectionAtom, dismissMutationsAtom, dryRunAtom, mutationGateAtom, runAtom, currentRunCodeAtom as runCodeAtom, sandboxAtom, runningAtom, stopRunAtom, settledRunAtom, activeDocumentAtom, runsAtom, setAnswer, inFlightAtom, inFlightDocumentAtom, currentResultAtom, appendOutputAtom} from '../editor'

// what the run was handed to the app as
const sent = () => window.api.runConnection.mock.calls

describe('the run a snippet is sent as', () => {
  let store

  beforeEach(() => {
    store = createStore()
    // the window is on a document: a run belongs to the tab that sent it
    store.set(activeDocumentAtom, 'doc')
    window.api.runConnection.mockClear()
  })

  test('is sent the way it always was when no guard is asked for', () => {
    store.set(runAtom, '$order = Order::first();')

    // nothing asked for a guard, and a guard is not guessed at: the run carries
    // no transaction at all
    expect(sent()).toEqual([['$order = Order::first();', null]])
  })

  test('is sent inside a sandboxed transaction the dry run switch takes back', () => {
    store.set(dryRunAtom, true)
    store.set(runAtom, '$order->update([\'paid\' => true]);')

    // the dry run is the sandbox by default: a transaction holds the database
    // and nothing else, and a run that is taken back must not have mailed anyone
    expect(sent()).toEqual([['$order->update([\'paid\' => true]);', 'sandbox']])
  })

  test('is sent as a plain transaction when the sandbox is switched off', () => {
    store.set(dryRunAtom, true)
    store.set(sandboxAtom, false)
    store.set(runAtom, '$order->update([\'paid\' => true]);')

    expect(sent()).toEqual([['$order->update([\'paid\' => true]);', 'rollback']])
  })

  test('is sent the way the switch says, once the switch is turned back off', () => {
    store.set(dryRunAtom, true)
    store.set(dryRunAtom, false)
    store.set(runAtom, '1;')

    expect(sent()).toEqual([['1;', null]])
  })

  test('is sent to keep its transaction when the pane asks it to, once', () => {
    store.set(dryRunAtom, true)
    store.set(runAtom, '$order->save();', {guard: 'commit'})

    expect(sent()).toEqual([['$order->save();', 'commit']])
    // what is run again is the code the run was sent with, and asking for one
    // run to be kept is not a change of the switch: the next run is a dry run
    // like this one was
    expect(store.get(runCodeAtom)).toBe('$order->save();')
    expect(store.get(dryRunAtom)).toBe(true)
  })

  test('is sent to take its transaction back when that is what is asked for', () => {
    store.set(runAtom, '1;', {guard: 'rollback'})

    expect(sent()).toEqual([['1;', 'rollback']])
  })
})

describe('the question a run that writes is asked', () => {
  let store

  beforeEach(() => {
    store = createStore()
    // the window is on a document: a run belongs to the tab that sent it
    store.set(activeDocumentAtom, 'doc')
    window.api.runConnection.mockClear()
  })

  test('holds a run that writes when its connection is tagged production', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'production'})
    store.set(runAtom, "DB::table('orders')->where('id', 3)->delete();")

    expect(store.get(mutationGateAtom)).toEqual({
      code: "DB::table('orders')->where('id', 3)->delete();",
      guard: null,
      writes: [{line: 1, call: 'delete'}],
    })
    // a held run is not a run that happened: nothing was sent, and nothing on
    // the pane was cleared for a run that is still waiting
    expect(sent()).toEqual([])
    expect(store.get(runCodeAtom)).toBe('')
  })

  test('sends the held run when the question is answered', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'production'})
    store.set(runAtom, '$order->save();')

    store.set(confirmMutationsAtom)

    expect(sent()).toEqual([['$order->save();', null]])
    expect(store.get(mutationGateAtom)).toBe(null)
    expect(store.get(runCodeAtom)).toBe('$order->save();')
  })

  test('sends the held run under the guard it was being sent under', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'production'})
    store.set(runAtom, '$order->save();', {guard: 'commit'})

    store.set(confirmMutationsAtom)

    expect(sent()).toEqual([['$order->save();', 'commit']])
  })

  test('drops the held run when the question is answered the other way', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'production'})
    store.set(runAtom, '$order->save();')

    store.set(dismissMutationsAtom)

    expect(sent()).toEqual([])
    expect(store.get(mutationGateAtom)).toBe(null)
  })

  test('asks nothing about a run that only reads', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'production'})
    store.set(runAtom, "DB::select('select * from orders');")

    expect(store.get(mutationGateAtom)).toBe(null)
    expect(sent()).toEqual([["DB::select('select * from orders');", null]])
  })

  test('asks nothing about a write on a connection that is not production', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'local'})
    store.set(runAtom, '$order->delete();')

    expect(store.get(mutationGateAtom)).toBe(null)
    expect(sent()).toEqual([['$order->delete();', null]])
  })

  test('asks nothing about a write a dry run takes back', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'production'})
    store.set(dryRunAtom, true)
    store.set(runAtom, '$order->delete();')

    expect(store.get(mutationGateAtom)).toBe(null)
    expect(sent()).toEqual([['$order->delete();', 'sandbox']])
  })

  test('asks about a dry run that holds what its transaction cannot take back', () => {
    const code = "DB::table('t')->insert(['a' => 1]);\nDB::statement('create table t2 (id int)');"

    store.set(connectionAtom, {name: 'orders', tag: 'production'})
    store.set(dryRunAtom, true)
    store.set(runAtom, code)

    expect(store.get(mutationGateAtom)).toEqual({
      code,
      guard: 'sandbox',
      writes: [{line: 2, call: 'create table', reason: 'ddl'}],
      unguardable: true,
    })
    expect(sent()).toEqual([])

    // answered, it goes as the dry run it was, without being asked again
    store.set(confirmMutationsAtom)

    expect(sent()).toEqual([[code, 'sandbox']])
  })

  test('asks about a dry run that writes to another connection', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'production'})
    store.set(dryRunAtom, true)
    store.set(runAtom, "DB::connection('sqlite')->table('s')->insert(['a' => 1]);")

    expect(store.get(mutationGateAtom).writes).toEqual([{line: 1, call: 'connection', reason: 'connection'}])
  })

  test('asks nothing about a dry run with DDL off production', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'local'})
    store.set(dryRunAtom, true)
    store.set(runAtom, 'DB::commit();')

    expect(store.get(mutationGateAtom)).toBe(null)
    expect(sent()).toEqual([['DB::commit();', 'sandbox']])
  })
})

describe('a run that is going', () => {
  let store

  beforeEach(() => {
    store = createStore()
    store.set(activeDocumentAtom, 'doc')
    window.api.runConnection.mockClear()
    window.api.stopConnection.mockClear()
  })

  test('is going until it answers, and the stop is what ends it otherwise', () => {
    expect(store.get(runningAtom)).toBe(false)

    store.set(runAtom, 'sleep(60);')
    expect(store.get(runningAtom)).toBe(true)

    store.set(stopRunAtom)
    expect(store.get(runningAtom)).toBe(false)
    // the session is what the stop ends, because the php is inside it
    expect(window.api.stopConnection).toHaveBeenCalledTimes(1)
  })

  test('is done with when its answer arrives', () => {
    store.set(runAtom, 'return 1;')
    store.set(settledRunAtom)

    expect(store.get(runningAtom)).toBe(false)
  })

  test('a run that was stopped is not stopped again', () => {
    store.set(runAtom, '1;')
    store.set(stopRunAtom)
    store.set(stopRunAtom)

    expect(window.api.stopConnection).toHaveBeenCalledTimes(1)
  })

  test('a run held by the production gate is not going yet', () => {
    store.set(connectionAtom, {name: 'orders', tag: 'production'})
    store.set(runAtom, "DB::table('t')->insert(['a' => 1]);")

    // the question is on screen and nothing was sent, so there is nothing to stop
    expect(store.get(runningAtom)).toBe(false)
    expect(window.api.runConnection).not.toHaveBeenCalled()
  })
})

describe('two tabs and their runs', () => {
  let store

  beforeEach(() => {
    store = createStore()
    window.api.runConnection.mockClear()
    window.api.stopConnection.mockClear()
  })

  const record = id => store.get(runsAtom)[id]
  // the answer the pane would read for a document, which is the record's result
  const resultOf = id => record(id).result

  // the bug this waits against: a run in one tab wrote the window's one result,
  // so a run in another tab wiped the first tab's answer — the pane showed one
  // document's result to every tab
  test('a run in one tab does not touch the answer of another', () => {
    store.set(activeDocumentAtom, 'one')
    store.set(runAtom, 'first();', {document: 'one'})
    store.set(setAnswer, {
      document: 'one',
      value: {value: 1, error: null, output: '', blocks: [{line: 1, value: 1, error: null}]},
    })

    store.set(activeDocumentAtom, 'two')
    store.set(runAtom, 'second();', {document: 'two'})
    store.set(setAnswer, {
      document: 'two',
      value: {value: 2, error: null, output: '', blocks: [{line: 1, value: 2, error: null}]},
    })

    // each tab kept its own answer
    expect(resultOf('one').value).toBe(1)
    expect(resultOf('two').value).toBe(2)

    // and the pane reads the document it is on
    expect(store.get(currentResultAtom).value).toBe(2)

    store.set(activeDocumentAtom, 'one')
    expect(store.get(currentResultAtom).value).toBe(1)
  })

  test('the code a tab ran is the code its own dot compares to', () => {
    store.set(runAtom, 'first();', {document: 'one'})
    store.set(runAtom, 'second();', {document: 'two'})

    expect(record('one').code).toBe('first();')
    expect(record('two').code).toBe('second();')
  })

  test('an answer that lands while another tab is open is put under the tab that sent it', () => {
    store.set(activeDocumentAtom, 'one')
    store.set(runAtom, 'first();', {document: 'one'})

    // the person moved to another tab while the run was going
    store.set(activeDocumentAtom, 'two')

    // the window reads the run that is going, not the document on screen
    const sending = store.get(inFlightDocumentAtom)

    expect(sending).toBe('one')

    store.set(setAnswer, {document: sending, value: {value: 42, error: null, output: ''}})
    store.set(inFlightAtom, null)

    // the answer is the tab that sent it, and the tab being read has none
    expect(resultOf('one').value).toBe(42)
    expect(store.get(currentResultAtom)).toBe(null)
  })

  // a connection has one session, so a second run ends the first: the button is
  // a stop wherever the person is
  test('a run that is going is the window one, whichever tab it was sent from', () => {
    store.set(runAtom, 'first();', {document: 'one'})
    store.set(activeDocumentAtom, 'two')

    expect(store.get(runningAtom)).toBe(true)

    store.set(activeDocumentAtom, 'one')
    store.set(stopRunAtom)

    expect(window.api.stopConnection).toHaveBeenCalled()
    expect(store.get(runningAtom)).toBe(false)
  })

  test('what a run printed is the printing tab output', () => {
    store.set(activeDocumentAtom, 'one')
    store.set(runAtom, 'echo "one";', {document: 'one'})
    store.set(appendOutputAtom, 'one')

    store.set(activeDocumentAtom, 'two')
    store.set(runAtom, 'echo "two";', {document: 'two'})
    store.set(appendOutputAtom, 'two')

    expect(record('one').output).toBe('one')
    expect(record('two').output).toBe('two')
  })
})
