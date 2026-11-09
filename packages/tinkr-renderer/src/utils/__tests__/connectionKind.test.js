import kindOf, {apiRunOf, isApiRun} from '../connectionKind'

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

  // the same for Vapor: a function environment is not a machine here either
  test('Laravel Vapor is the kind, whatever else the connection carries', () => {
    expect(kindOf({is_vapor: true})).toBe('connections.kind_vapor')
    expect(kindOf({is_vapor: true, is_over_ssh: true, container_engine: 'docker'})).toBe('connections.kind_vapor')
    expect(kindOf({is_vapor: true, tag: 'production'})).toBe('connections.kind_vapor')
  })
})

// one question — does a run leave this machine — asked in four places, so it is
// asked here once. Which product it is is the answer only where the reason for a
// missing action names one of them
describe('whether a connection runs through an API', () => {
  test('is one of the two products, or nothing', () => {
    expect(apiRunOf({is_cloud: true})).toBe('cloud')
    expect(apiRunOf({is_vapor: true})).toBe('vapor')
    expect(apiRunOf({container_engine: 'docker'})).toBe(null)
    expect(apiRunOf()).toBe(null)
  })

  test('is what the gates read', () => {
    expect(isApiRun({is_cloud: true})).toBe(true)
    expect(isApiRun({is_vapor: true})).toBe(true)
    expect(isApiRun({is_over_ssh: true})).toBe(false)
    expect(isApiRun(null)).toBe(false)
  })
})
