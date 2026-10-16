import {createStore} from 'jotai'

import {confirmMutationsAtom, connectionAtom, dismissMutationsAtom, dryRunAtom, mutationGateAtom, runAtom, runCodeAtom} from '../editor'

// what the run was handed to the app as
const sent = () => window.api.runConnection.mock.calls

describe('the run a snippet is sent as', () => {
  let store

  beforeEach(() => {
    store = createStore()
    window.api.runConnection.mockClear()
  })

  test('is sent the way it always was when no guard is asked for', () => {
    store.set(runAtom, '$order = Order::first();')

    // nothing asked for a guard, and a guard is not guessed at: the run carries
    // no transaction at all
    expect(sent()).toEqual([['$order = Order::first();', null]])
  })

  test('is sent inside a transaction the dry run switch takes back', () => {
    store.set(dryRunAtom, true)
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
    expect(sent()).toEqual([['$order->delete();', 'rollback']])
  })
})
