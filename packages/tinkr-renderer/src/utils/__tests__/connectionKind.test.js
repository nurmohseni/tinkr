import kindOf from '../connectionKind'

describe('what a connection is called', () => {
  test('a plain connection is local or ssh', () => {
    expect(kindOf({})).toBe('connections.kind_local')
    expect(kindOf({is_over_ssh: true})).toBe('connections.kind_ssh')
  })

  test('a container is one, on this machine or on a server', () => {
    expect(kindOf({container_engine: 'docker'})).toBe('connections.kind_container')
    expect(kindOf({container_engine: 'docker', is_over_ssh: true})).toBe('connections.kind_ssh_container')
  })

  // the tag says what kind of data a connection reaches, and where the code runs
  // is the other question: a production connection is the one a reader has to
  // know before typing, so it outranks the rest
  test('production outranks the way in', () => {
    expect(kindOf({tag: 'production'})).toBe('connections.kind_production')
    expect(kindOf({tag: 'production', is_over_ssh: true})).toBe('connections.kind_production')
  })

  // a cloud connection has no machine and no container of its own, so it is the
  // whole of what it is: nothing about ssh outranks it, and neither does the tag,
  // which is still drawn beside it as the row's stage
  test('Laravel Cloud is the kind, whatever else the connection carries', () => {
    expect(kindOf({is_cloud: true})).toBe('connections.kind_cloud')
    expect(kindOf({is_cloud: true, is_over_ssh: true, container_engine: 'docker'})).toBe('connections.kind_cloud')
    expect(kindOf({is_cloud: true, tag: 'production'})).toBe('connections.kind_cloud')
  })
})
