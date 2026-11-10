// the two programs the read runs, as text: what they must never contain, what a
// name inside them must survive, and what a checkout that has not been set up
// yet answers with
const {execFileSync} = require('child_process')
const {mkdtempSync, rmSync, writeFileSync} = require('fs')
const {tmpdir} = require('os')
const {join} = require('path')
const {intelCode, classCode} = require('../intelScript')

/**
 * The whole read, run in a directory, as the project it is pointed at.
 *
 * @param {String} dir
 * @return {Object}
 */
const read = dir => JSON.parse(execFileSync('php', [], {encoding: 'utf8', input: intelCode(), cwd: dir, maxBuffer: 16 * 1024 * 1024}))

describe('the programs the read runs', () => {
  test('both are php, with nothing that would end the mode they are run in', () => {
    for (const program of [intelCode(), classCode('App\\Models\\User')]) {
      expect(typeof program).toBe('string')
      expect(program.startsWith('<?php\n')).toBe(true)
      // no closing tag, and none written anywhere inside: a `?>` in the middle of
      // the program would hand the rest of it to the output
      expect(program.includes('?>')).toBe(false)
      // a backtick in a template literal would end the string it is written in
      expect(program.includes('`')).toBe(false)
    }
  })

  test('the whole read answers every key the intel takes', () => {
    const program = intelCode()

    for (const key of [
      'version', 'project', 'booted', 'models', 'classes', 'builders', 'facades',
      'config', 'routes', 'views', 'translations', 'env', 'bindings', 'functions',
      'constants', 'own',
    ]) {
      expect(program).toContain(`'${key}'`)
    }
  })

  test('one class read takes the name it is given, escaped as php writes it', () => {
    expect(classCode('App\\Models\\User')).toContain("$tinkr_name = 'App\\\\Models\\\\User';")
  })

  test('a name can carry anything the editor has, and stays inside its string', () => {
    const program = classCode("App\\Models\\X'; echo 'pwned'; //")

    expect(program).toContain("\\'; echo \\'pwned\\'; //")
    // the quote is escaped, so the statement is still one statement
    expect(program.includes("X'; echo")).toBe(false)
  })
})

describe('the env keys of a checkout', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tinkr-env-'))
  })

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true})
  })

  // a fresh checkout has no `.env` — it is written from the example it ships with,
  // and never committed — so the example is the only list of names there is
  test('a project with no .env answers with the example keys, and only their names', () => {
    writeFileSync(join(dir, '.env.example'), [
      'APP_NAME=Laravel',
      'APP_KEY=',
      '',
      '# a comment is not a key',
      'DB_CONNECTION=sqlite',
      'export NOT_A_KEY=1',
      'MAIL_FROM_ADDRESS="hello@example.com"',
    ].join('\n'))

    const answer = read(dir)

    expect(answer.env).toEqual(['APP_NAME', 'APP_KEY', 'DB_CONNECTION', 'MAIL_FROM_ADDRESS'])
    // the editor never needs a secret, and this answer is written to disk
    expect(JSON.stringify(answer)).not.toContain('hello@example.com')
    expect(JSON.stringify(answer)).not.toContain('sqlite')
  })

  test('.env wins over the example when both are there', () => {
    writeFileSync(join(dir, '.env.example'), 'APP_NAME=Laravel\nAPP_ENV=local\n')
    writeFileSync(join(dir, '.env'), 'APP_NAME=Laravel\nAPP_ENV=production\n')

    expect(read(dir).env).toEqual(['APP_NAME', 'APP_ENV'])
  })

  test('a checkout with neither has no env keys to offer', () => {
    expect(read(dir).env).toEqual([])
  })
})
