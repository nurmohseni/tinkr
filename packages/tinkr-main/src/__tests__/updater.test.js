jest.mock('electron', () => ({BrowserWindow: {getAllWindows: () => []}}))

jest.mock('electron-updater', () => ({
  autoUpdater: {
    checkForUpdates: jest.fn(),
    downloadUpdate: jest.fn(),
    quitAndInstall: jest.fn(),
    on: jest.fn(),
  },
}))

jest.mock('electron-log', () => ({info: jest.fn(), warn: jest.fn(), transports: {file: {level: 'info'}}}))

jest.mock('fs', () => ({existsSync: jest.fn()}))

const {autoUpdater} = require('electron-updater')
const fs = require('fs')

const {checkForUpdates} = require('../updater')

// electron puts this beside the app; a plain Node process has no resources
beforeEach(() => {
  jest.clearAllMocks()
  process.resourcesPath = '/opt/tinkr/resources'
})

describe('checkForUpdates', () => {
  it('says the build cannot update itself when it has no app-update.yml', async () => {
    fs.existsSync.mockReturnValue(false)

    expect(await checkForUpdates()).toEqual({status: 'unavailable'})
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('says the running version is the newest one', async () => {
    fs.existsSync.mockReturnValue(true)
    autoUpdater.checkForUpdates.mockResolvedValue({isUpdateAvailable: false, updateInfo: {version: '0.4.4'}})

    expect(await checkForUpdates()).toEqual({status: 'newest'})
  })

  it('says which version is out', async () => {
    fs.existsSync.mockReturnValue(true)
    autoUpdater.checkForUpdates.mockResolvedValue({isUpdateAvailable: true, updateInfo: {version: '0.4.5'}})

    expect(await checkForUpdates()).toEqual({status: 'available', latest: '0.4.5'})
  })

  it('says why the releases could not be read', async () => {
    fs.existsSync.mockReturnValue(true)
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))

    expect(await checkForUpdates()).toEqual({
      status: 'failed',
      message: 'net::ERR_INTERNET_DISCONNECTED',
    })
  })

  // the updater answers nothing at all when it is not allowed to run, which is
  // every build that was not installed from a release
  it('says the build cannot update itself when the updater refuses to run', async () => {
    fs.existsSync.mockReturnValue(true)
    autoUpdater.checkForUpdates.mockResolvedValue(null)

    expect(await checkForUpdates()).toEqual({status: 'unavailable'})
  })
})
