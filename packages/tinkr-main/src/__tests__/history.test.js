const {appendHistory, allHistory, outcomeOf} = require('../services/history')

describe('what a run is recorded as', () => {
  test('a value that came back is a run that returned', () => {
    expect(outcomeOf({value: 1, error: null})).toBe('returned')
    expect(outcomeOf({value: false, error: null})).toBe('returned')
    expect(outcomeOf({value: '', error: null})).toBe('returned')
  })

  test('a run that only printed returned nothing', () => {
    expect(outcomeOf({value: null, error: null})).toBe('printed')
    expect(outcomeOf({value: undefined, error: null})).toBe('printed')
  })

  test('an exception is a run that threw', () => {
    expect(outcomeOf({value: null, error: {class: 'Error', message: 'no'}})).toBe('threw')
    expect(outcomeOf({value: 1, error: {class: 'Error', message: 'no'}})).toBe('threw')
  })

  test('a session that printed no envelope at all is a run that printed', () => {
    expect(outcomeOf(null)).toBe('printed')
  })
})

describe('the history of a connection', () => {
  test('records the code that ran, when it ran, and what came back', () => {
    const before = Date.now()
    const [entry] = appendHistory('recorded', '$user = User::first();', {value: null, error: null})

    expect(entry.code).toBe('$user = User::first();')
    expect(entry.outcome).toBe('printed')
    expect(entry.at).toBeGreaterThanOrEqual(before)
    expect(entry.at).toBeLessThanOrEqual(Date.now())
    expect(entry.id).toHaveLength(16)
    expect(allHistory('recorded')).toEqual([entry])
  })

  test('keeps the newest run first', () => {
    appendHistory('ordered', 'the first run', {value: 1, error: null})
    appendHistory('ordered', 'the second run', {value: null, error: null})

    expect(allHistory('ordered').map(entry => entry.code)).toEqual(['the second run', 'the first run'])
  })

  test('caps the list and drops the oldest run', () => {
    for (let run = 0; run <= 50; run++) {
      appendHistory('capped', `run ${run}`, {value: null, error: null})
    }

    const entries = allHistory('capped')

    expect(entries).toHaveLength(50)
    expect(entries[0].code).toBe('run 50')
    expect(entries[49].code).toBe('run 1')
  })

  test('every connection keeps its own runs', () => {
    appendHistory('mine', 'my run', {value: null, error: null})

    expect(allHistory('yours')).toEqual([])
    expect(allHistory('mine')).toHaveLength(1)
  })
})
