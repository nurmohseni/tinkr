const fs = require('fs')
const os = require('os')
const path = require('path')

// a directory of the test's own, made before anything is imported: a store is
// opened where the app's user data would be the moment it is required
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-secrets-'))

fs.mkdirSync(path.join(dir, 'app'), {recursive: true})

jest.mock('electron', () => ({
  app: {getLocale: () => 'en', getPath: () => global.TINKR_TEST_DIR, getAppPath: () => '/tmp', isPackaged: false, on: () => {}},
  ipcMain: {on: () => {}, handle: () => {}},
  BrowserWindow: class {},
  Menu: {setApplicationMenu: () => {}},
}))

global.TINKR_TEST_DIR = dir

const secrets = require('../database/secrets')
const {connections, sessionConnection} = require('../database/connections')

beforeEach(() => {
  fs.mkdirSync(path.join(dir, 'app'), {recursive: true})
})

const kept = () => JSON.parse(fs.readFileSync(path.join(dir, 'app', 'secrets.json'), 'utf8'))

// a connection as the form hands it over: the password is a field of the form,
// and the store is what keeps it out of the connection
const form = (fields = {}) => Object.assign({
  id: 'c1',
  name: 'db',
  is_over_ssh: true,
  ssh_user: 'root',
  ssh_server: 'db.example.com',
}, fields)

describe('a password a connection was given', () => {
  test('is kept in its own file, and never in the connection', () => {
    const stored = secrets.keptConnection(dir, form({password: 'hunter2'}), {})

    expect(stored.password).toBe(undefined)
    expect(stored.ssh_password).toBe(true)
    expect(JSON.stringify(stored)).not.toContain('hunter2')
    expect(kept()).toEqual({c1: 'hunter2'})
  })

  // a save carries every field of the form, and one that never touched this one
  // must not read as the field having been cleared
  test('survives a save that does not touch it, and is replaced by one that does', () => {
    const first = secrets.keptConnection(dir, form({password: 'hunter2'}), {})

    const autosaved = secrets.keptConnection(dir, Object.assign({}, first, {name: 'renamed', password: ''}), first)
    expect(autosaved.ssh_password).toBe(true)
    expect(kept()).toEqual({c1: 'hunter2'})

    secrets.keptConnection(dir, Object.assign({}, autosaved, {password: 'second'}), autosaved)
    expect(kept()).toEqual({c1: 'second'})
  })

  // a connection that is no longer over ssh has no use for the password it had,
  // and keeping it is a secret held for nobody
  test('goes when the connection stops being an ssh one', () => {
    const first = secrets.keptConnection(dir, form({password: 'hunter2'}), {})

    const local = secrets.keptConnection(dir, Object.assign({}, first, {is_over_ssh: false}), first)

    expect(local.ssh_password).toBe(false)
    expect(kept()).toEqual({})
  })

  test('is forgotten only when it is forgotten', () => {
    secrets.keptConnection(dir, form({password: 'hunter2'}), {})
    expect(kept()).toEqual({c1: 'hunter2'})

    secrets.forget(dir, 'c1')
    expect(kept()).toEqual({})
  })

  test('is a file only its owner can read', () => {
    secrets.keptConnection(dir, form({password: 'hunter2'}), {})

    // windows has no mode bits; its file permissions are the account's own
    const mode = process.platform === 'win32'
      ? null
      : fs.statSync(path.join(dir, 'app', 'secrets.json')).mode & 0o777

    expect(mode).toBe(process.platform === 'win32' ? null : 0o600)
  })
})

describe('the connection a session boots from', () => {
  // the bug this waits against: the form was handed to the session as it came,
  // and a password typed into a new connection's form had reached the secret
  // file while the flag the session reads said there was none — so the first
  // session of a connection with a password asked the terminal for it
  test('is the stored one, whose flag says a password was kept', () => {
    const stored = secrets.keptConnection(dir, form({password: 'hunter2'}), {})

    connections.set(stored.id, stored)

    const booted = sessionConnection(form({password: ''}))
    expect(booted.ssh_password).toBe(true)
    expect(JSON.stringify(booted)).not.toContain('hunter2')
  })

  // a connection the store does not hold — a draft, a quick connection, a test —
  // is handed on as it came
  test('is the connection itself when the store does not hold it', () => {
    const draft = form({id: 'draft'})

    expect(sessionConnection(draft)).toBe(draft)
    expect(sessionConnection({})).toEqual({})
  })
})
