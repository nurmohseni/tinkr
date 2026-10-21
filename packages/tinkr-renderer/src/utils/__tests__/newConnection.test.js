import {webcrypto} from 'crypto'

import {newConnection, newConnectionId} from '../newConnection'

// nanoid draws its ids from the Web Crypto API, which jsdom does not provide
global.crypto = webcrypto

describe('newConnection', () => {
  test('drafts a connection the store does not hold yet', () => {
    expect(newConnection('New Connection')).toEqual({
      id: expect.any(String),
      tag: 'local',
      name: 'New Connection',
      is_over_ssh: false,
      path: '',
      command: '',
      is_cloud: false,
      cloud_application_id: '',
      cloud_application_name: '',
      cloud_environment_id: '',
      cloud_environment_name: '',
    })
  })

  test('gives every draft an id of its own, never the route of a draft', () => {
    const ids = [newConnection('New Connection').id, newConnection('New Connection').id]

    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain(newConnectionId)
  })
})
