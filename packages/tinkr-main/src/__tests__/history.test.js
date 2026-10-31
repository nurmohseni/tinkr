const {defaultRedactFields} = require('tinkr-core')

const {config} = require('../database/config')
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

  test('running the latest snippet again keeps only its first run', () => {
    const [first] = appendHistory('repeated', '$n = 1;', {value: 1, error: null})
    appendHistory('repeated', '$n = 1;', {value: 2, error: null})

    expect(allHistory('repeated')).toEqual([first])
  })

  test('a snippet that differs from the latest run, even by whitespace, is recorded', () => {
    appendHistory('changed', '$n = 1;', {value: 1, error: null})
    appendHistory('changed', '$n = 1; ', {value: 1, error: null})
    appendHistory('changed', '$n = 1;', {value: 1, error: null})

    expect(allHistory('changed').map(entry => entry.code)).toEqual(['$n = 1;', '$n = 1; ', '$n = 1;'])
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

describe('what the history hides', () => {
  afterEach(() => {
    config.set('redact_fields', [...defaultRedactFields])
  })

  test('keeps a hidden field as [hidden], not as the value that came back', () => {
    const [entry] = appendHistory('hidden', 'User::first();', {
      value: {id: 1, name: 'Ada', password: 'hunter2', remember_token: 'Zx9'},
      error: null,
    })

    expect(entry.value).toEqual({id: 1, name: 'Ada', password: '[hidden]', remember_token: '[hidden]'})
  })

  test('hides a field at any depth, and in a list of models', () => {
    const [entry] = appendHistory('nested', 'User::all();', {
      value: {data: [{id: 1, token: 'a'}, {id: 2, token: 'b'}], meta: {secret: 's'}},
      error: null,
    })

    expect(entry.value).toEqual({data: [{id: 1, token: '[hidden]'}, {id: 2, token: '[hidden]'}], meta: {secret: '[hidden]'}})
  })

  test('keeps what the run printed, which has no field names to go by', () => {
    const [entry] = appendHistory('printed', 'echo "password: hunter2";', {
      value: null,
      error: null,
      output: 'password: hunter2',
    })

    expect(entry.output).toBe('password: hunter2')
  })

  test('is the fields the settings name, and an empty list keeps everything', () => {
    config.set('redact_fields', ['nickname'])

    const [named] = appendHistory('named', '$user = $one;', {value: {nickname: 'Ada', password: 'hunter2'}, error: null})

    expect(named.value).toEqual({nickname: '[hidden]', password: 'hunter2'})

    config.set('redact_fields', [])

    const [kept] = appendHistory('kept', '$user = $two;', {value: {nickname: 'Ada', password: 'hunter2'}, error: null})

    expect(kept.value).toEqual({nickname: 'Ada', password: 'hunter2'})
  })

  test('hides before it decides how much of the value fits', () => {
    const value = {password: 'x'.repeat(9000), name: 'Ada'}
    const [entry] = appendHistory('sized', '$user = $big;', {value, error: null})

    // the masked value is small enough to keep, and the size that was checked
    // is the size that is written
    expect(entry.value).toEqual({password: '[hidden]', name: 'Ada'})
  })
})
