const {appendHistory, allHistory, outcomeOf, answerOf} = require('../services/history')

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

describe('what a run is recorded with', () => {
  test('keeps what the run returned, and what it printed', () => {
    const [returned] = appendHistory('answered', '$n = 3;', {value: 3, error: null, output: ''})
    const [printed] = appendHistory('answered', 'echo "hi";', {value: null, error: null, output: 'hi'})

    expect(returned.value).toBe(3)
    expect(printed.output).toBe('hi')
    expect(printed.value).toBeUndefined()
  })

  test('keeps the exception a run threw with it', () => {
    const [entry] = appendHistory('thrown', 'throw new RuntimeException("boom");', {
      value: null,
      error: {class: 'RuntimeException', message: 'boom'},
      output: '',
    })

    expect(entry.outcome).toBe('threw')
    expect(entry.error).toEqual({class: 'RuntimeException', message: 'boom'})
  })

  test('leaves out an answer too big to keep, and names what was left out', () => {
    const [entry] = appendHistory('huge', 'User::all();', {
      value: new Array(9000).fill(1),
      error: null,
      output: 'x'.repeat(9000),
    })

    // the file is read whole when a window switches connection
    expect(entry.value).toBeUndefined()
    expect(entry.output).toBeUndefined()
    expect(entry.cut).toEqual(['value', 'output'])
  })

  test('a run the session never answered for is recorded as what it is', () => {
    expect(answerOf(null)).toEqual({})
    expect(answerOf(undefined)).toEqual({})
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
