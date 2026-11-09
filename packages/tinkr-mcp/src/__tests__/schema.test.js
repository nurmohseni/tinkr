const schema = require('../schema')
const {TOOLS} = require('../server')

const tool = name => TOOLS.find(one => one.name === name)

describe('the arguments a tool declares', () => {
  test('lets a call that fits the schema through', () => {
    expect(schema.problemOf(tool('tinkr_tail_logs'), {
      connection: 'one',
      level: ['error', 'warning'],
      bytes: 4096,
      since: '2026-08-27 11:10:52',
    })).toBe(null)
  })

  test('names the item of a list that is not one of the values', () => {
    expect(schema.problemOf(tool('tinkr_tail_logs'), {level: ['error', 'verbose']}))
      .toBe('`level[1]` has to be one of "debug", "info", "notice", "warning", "error", ' +
        '"critical", "alert", "emergency", not "verbose".')
  })

  test('refuses a number outside the range the schema gives it', () => {
    expect(schema.problemOf(tool('tinkr_tail_logs'), {bytes: 10}))
      .toBe('`bytes` has to be at least 1024: it was 10.')
    expect(schema.problemOf(tool('tinkr_tail_logs'), {bytes: 4096.5}))
      .toBe('`bytes` has to be a whole number, not a number.')
  })

  test('refuses a boolean where a string is declared', () => {
    expect(schema.problemOf(tool('tinkr_read_run'), {id: true}))
      .toBe('`id` has to be a string, not true or false.')
  })

  // a client that serialises an absent optional as null sent nothing, which is
  // how every tool here reads it
  test('reads a null as an argument that was not sent', () => {
    expect(schema.problemOf(tool('tinkr_run_php'), {code: '1;', guard: null, timeout_ms: null})).toBe(null)
    expect(schema.problemOf(tool('tinkr_read_run'), {id: null}))
      .toBe('`id` is required: it was not sent.')
  })

  test('says a tool with no arguments takes none', () => {
    expect(schema.problemOf(tool('tinkr_list_connections'), {})).toBe(null)
    expect(schema.problemOf(tool('tinkr_list_connections'), {connection: 'one'}))
      .toBe('`connection` is not an argument tinkr_list_connections takes: it takes none.')
  })
})
