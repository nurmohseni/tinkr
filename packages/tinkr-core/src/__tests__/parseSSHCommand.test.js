const {parseSSHCommand, sshArgs} = require('../parseSSHCommand')

describe.each([
  [
    {
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
    },

    'ssh root@192.168.1.1',
  ],

  [
    {
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
      ssh_port: '2000',
    },

    'ssh -p2000 root@192.168.1.1',
  ],

  [
    {
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
      ssh_port: '2000',
      ssh_key: '/usr/local/id.pem',
    },

    'ssh -p2000 -i/usr/local/id.pem root@192.168.1.1',
  ],

  [
    {
      path: '/var/www/html',
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
      ssh_port: '2000',
      ssh_key: '/usr/local/id.pem',
    },

    'ssh -p2000 -i/usr/local/id.pem root@192.168.1.1 -t \'cd /var/www/html;bash --login\'',
  ],
])('test parseSSHCommand(%o)', (connection, expected) => {
  it(`should return ${expected}`, () => {
    expect(parseSSHCommand(connection)).toBe(expected)
  })
})

describe.each([
  [
    {
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
    },

    ['root@192.168.1.1'],
  ],

  [
    {
      ssh_server: '192.168.1.1',
      ssh_user: 'root',
      ssh_port: '2000',
      ssh_key: '/usr/local/id.pem',
      path: '/var/www/html',
    },

    ['-p2000', '-i/usr/local/id.pem', 'root@192.168.1.1'],
  ],
])('test sshArgs(%o)', (connection, expected) => {
  it(`should return ${expected}`, () => {
    // the path of a connection is not an argument of reaching it: what runs
    // there is given the path of the project itself
    expect(sshArgs(connection)).toEqual(expected)
  })
})
