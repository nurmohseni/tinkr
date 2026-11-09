// the machine a project is read from is not under test here: what a read of it
// is given — how long it may take, and how much of an answer it keeps — is
jest.mock('../../remote', () => ({
  exec: jest.fn(),
  quoted: value => `'${String(value).replace(/'/g, "'\\''")}'`,
}))

const {exec} = require('../../remote')

const {indexFor, clearRemoteIndexes} = require('../project')

const connection = {id: 'over-ssh', is_over_ssh: true, path: '/var/www/app'}

beforeEach(() => {
  exec.mockReset()
  clearRemoteIndexes()
})

describe('reading a project off another machine', () => {
  // the bug this waits against: the index walk shared the ten second default a
  // question about one file is given, so a cold walk of a large project over a
  // slow link was cut off and read as a machine that said nothing
  test('gives the index walk time to finish, and asks for it explicitly', async () => {
    exec.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({classmap: {}, psr4: {}, files: []}),
      stderr: '',
    })

    await indexFor(connection)

    // the walk is a `php -r` of the whole project, and 30 seconds is its own
    // budget rather than the shorter default every other read keeps
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0]).toBe(connection)
    expect(exec.mock.calls[0][1]).toContain('php -r')
    expect(exec.mock.calls[0][2]).toEqual({maxBuffer: 8 * 1024 * 1024, timeout: 30000})
  })

  test('answers null when the walk could not be read within its budget', async () => {
    // a read that ran out of time answers with no code and nothing printed,
    // which the index reads as a machine that could not be asked
    exec.mockResolvedValue({code: null, stdout: '', stderr: ''})

    expect(await indexFor(connection)).toBe(null)
  })
})
