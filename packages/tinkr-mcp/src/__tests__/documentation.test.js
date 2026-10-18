const {topics, articles, documentation} = require('../documentation')

// the tool names the server actually exposes, read out of its source: a tool
// added without words fails here, and words about a tool that is gone do too
const exposed = () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8')
  const names = []
  const pattern = /name: '(tinkr_[a-z_]+)'/g
  let found = pattern.exec(text)

  while (found) {
    names.push(found[1])
    found = pattern.exec(text)
  }

  return names
}

describe('the documentation', () => {
  test('has a topic for every tool the server exposes', () => {
    const text = articles.tools

    for (const name of exposed()) {
      expect(text).toContain(`\`${name}\``)
    }
  })

  test('does not name a tool the server does not have', () => {
    const names = exposed()
    const mentioned = [...articles.tools.matchAll(/`(tinkr_[a-z_]+)`/g)].map(found => found[1])

    for (const name of mentioned) {
      expect(names).toContain(name)
    }
  })

  test('every topic is a real article, and the list says what each is for', () => {
    for (const topic of topics) {
      expect(typeof articles[topic.name]).toBe('string')
      expect(articles[topic.name].length).toBeGreaterThan(200)
      expect(topic.summary.length).toBeGreaterThan(10)
      expect(topic.title.length).toBeGreaterThan(3)
    }
  })

  test('answers the overview when it is not told which topic', () => {
    const answer = documentation()

    expect(answer.topic).toBe('overview')
    expect(answer.text).toContain('A run is one snippet')
  })

  test('answers every topic at once for "all"', () => {
    const answer = documentation('all')

    expect(answer.topic).toBe('all')
    for (const topic of topics) {
      expect(answer.text).toContain(articles[topic.name])
    }
  })

  test('says which topics there are rather than guessing at a wrong one', () => {
    const answer = documentation('dry-runs')

    expect(answer.text).toContain('There is no topic "dry-runs"')
    for (const topic of topics) {
      expect(answer.text).toContain(topic.name)
    }
  })
})
