import {guardReport, sandboxReport} from '../guardReport'

describe('the guard report', () => {
  test('is nothing for a run that was not guarded', () => {
    expect(guardReport(undefined)).toBe(null)
  })

  test('never claims a rollback the guard did not make', () => {
    const broken = guardReport({
      mode: 'rollback',
      armed: true,
      connection: 'mysql',
      statements: 2,
      outcome: 'broken',
      error: 'the transaction was closed',
      unguarded: {},
    })

    // the transaction was gone before the close, so what the run changed may
    // have been kept: that is an error, not a success
    expect(broken.id).toBe('guard.broken')
    expect(broken.tone).toBe('error')
    expect(broken.keep).toBe(false)
  })

  test('says a dry run was taken back only when the guard says so', () => {
    const report = guardReport({
      mode: 'rollback',
      armed: true,
      connection: 'mysql',
      statements: 2,
      outcome: 'rolledBack',
      error: null,
      unguarded: {},
    }, {error: null, queries: [{connection: 'mysql', sql: 'insert into t values (1)'}], queriesTotal: 1})

    expect(report.id).toBe('guard.rolled_back')
    expect(report.tone).toBe('ok')
    // a write was taken back, so keeping it again is offered
    expect(report.keep).toBe(true)
  })
})

describe('the sandbox report', () => {
  test('says what the run caught, and names the first few', () => {
    const report = sandboxReport({
      channels: {mail: 2, requests: 1, jobs: 1, notifications: 0},
      sent: ['Order 1 to a@b.c', 'Order 2 to d@b.c'],
      requested: ['GET https://api.example/x'],
      not_sandboxed: [],
    })

    expect(report.id).toBe('guard.sandbox_report')
    expect(report.values.summary).toBe('2 mail, 1 requests, 1 jobs')
    expect(report.sent).toHaveLength(2)
    expect(report.requested).toEqual(['GET https://api.example/x'])
    // every channel was swapped, so the dry run held where it said it did
    expect(report.tone).toBe('ok')
  })

  test('says a run caught nothing without pretending that is a failure', () => {
    const report = sandboxReport({channels: {mail: 0, jobs: 0}, sent: [], requested: [], not_sandboxed: []})

    expect(report.id).toBe('guard.sandbox_nothing')
    expect(report.tone).toBe('ok')
  })

  test('warns when a channel could not be sealed', () => {
    // a dry run that only looks sealed is worse than one that says it was not
    const report = sandboxReport({
      channels: {},
      not_sandboxed: ['mail could not be sandboxed: no mailer'],
    })

    expect(report.tone).toBe('error')
    expect(report.notSandboxed).toEqual(['mail could not be sandboxed: no mailer'])
  })

  test('is nothing at all for a run that was not sandboxed', () => {
    expect(sandboxReport(undefined)).toBe(null)
    expect(sandboxReport(null)).toBe(null)
  })
})
