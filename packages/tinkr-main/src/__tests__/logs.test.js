jest.mock('electron', () => ({app: {getLocale: () => 'en', getPath: () => '/tmp/tinkr-data'}}))
jest.mock('electron-store', () => class Store {
  get(key, fallback) {
    return key === 'log_dir' ? 'var/logs' : fallback
  }
})

const fs = require('fs')
const os = require('os')
const path = require('path')

const {files, read} = require('../services/logs')

/**
 * The app's side of the log reading: the directory the preferences name, and
 * where the app's own data is.
 *
 * The reading itself is core's, and core's tests are where its windows, ranges
 * and filters are read; what is tested here is that the app hands it what only
 * the app knows.
 */
describe('the logs the app reads', () => {
  let root = ''

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-app-logs-'))
    fs.mkdirSync(path.join(root, 'var', 'logs'), {recursive: true})
    fs.writeFileSync(
      path.join(root, 'var', 'logs', 'app.log'),
      '[2026-08-27 11:00:00] production.INFO: the job ran\n',
    )
  })

  afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

  test('are looked for where the preferences say, not where laravel puts them by default', () => {
    const answer = files({path: root, is_over_ssh: false})

    expect(answer.dir).toBe(path.join(root, 'var', 'logs'))
    expect(answer.files.map(one => one.name)).toEqual(['app.log'])
  })

  test('are read from that directory, and its entries are the file\'s', () => {
    const answer = read({path: root, is_over_ssh: false}, 'app.log')

    expect(answer.entries).toEqual([{
      at: '2026-08-27 11:00:00',
      environment: 'production',
      level: 'info',
      message: 'the job ran',
      details: '',
    }])
  })
})
