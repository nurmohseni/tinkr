const fs = require('fs')
const path = require('path')

const {parse} = require('@babel/parser')

// the ids the renderer asks for are checked against the files the main process
// hands react-intl, because a missing id does not throw: the window draws the
// id itself, in the place of the words
const sourceRoot = path.join(__dirname, '..')
const langRoot = path.join(__dirname, '../../../tinkr-main/src/lang')

const read = locale => JSON.parse(
  fs.readFileSync(path.join(langRoot, `${locale}.json`), 'utf8'),
)

/** Every key of a message file, however deep, as the id it is looked up by. */
const keys = (messages, at = '') => Object.entries(messages).flatMap(([key, value]) => (
  value !== null && typeof value === 'object' ? keys(value, `${at}${key}.`) : [`${at}${key}`]
))

const english = keys(read('en'))
const englishIds = new Set(english)

/** Every source file of the renderer, the tests themselves left out. */
const sources = (dir = sourceRoot) => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
  const full = path.join(dir, entry.name)

  if (entry.isDirectory()) {
    return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sources(full)
  }

  return /\.jsx?$/.test(entry.name) ? [full] : []
})

// an id is a literal where it is written; one picked by a condition or built
// from a template is not a literal, and is left to the code that builds it
const literal = node => (node && node.type === 'StringLiteral' ? node.value : null)

const isFormatMessage = callee => (
  (callee.type === 'Identifier' && callee.name === 'formatMessage') ||
  (
    callee.type === 'MemberExpression' &&
    callee.property &&
    (callee.property.name === 'formatMessage' || callee.property.value === 'formatMessage')
  )
)

// the parts of a node that describe it rather than belong to it
const skipped = new Set(['loc', 'start', 'end', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments'])

/**
 * The ids a source file names, walked off the tree the jsx transform already
 * reads: an id on a <FormattedMessage>, the id of an intl.formatMessage
 * descriptor, and the id a component's own say() is handed.
 */
const idsIn = file => {
  const found = []

  const add = (id, at) => {
    if (id !== null) {
      found.push({id, at})
    }
  }

  const walk = (node, at) => {
    if (!node || typeof node !== 'object') {
      return
    }

    if (Array.isArray(node)) {
      node.forEach(child => walk(child, at))
      return
    }

    const here = `${at}:${node.loc ? node.loc.start.line : '?'}`

    if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && node.name.name === 'FormattedMessage') {
      const id = node.attributes.find(attribute => (
        attribute.type === 'JSXAttribute' && attribute.name.name === 'id'
      ))

      add(literal(id && id.value), here)
    }

    if (node.type === 'CallExpression' && isFormatMessage(node.callee)) {
      const descriptor = node.arguments[0]

      if (descriptor && descriptor.type === 'ObjectExpression') {
        const id = descriptor.properties.find(property => (
          property.type === 'ObjectProperty' && (property.key.name === 'id' || property.key.value === 'id')
        ))

        add(literal(id && id.value), here)
      }
    }

    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'say') {
      add(literal(node.arguments[0]), here)
    }

    Object.entries(node).forEach(([key, value]) => {
      if (!skipped.has(key) && value && typeof value === 'object') {
        walk(value, at)
      }
    })
  }

  walk(parse(fs.readFileSync(file, 'utf8'), {sourceType: 'module', plugins: ['jsx']}), path.relative(sourceRoot, file))

  return found
}

const used = sources().flatMap(idsIn)

describe('the messages the renderer names', () => {
  test('the renderer names its messages as literals, so there are ids to check', () => {
    // a collector that found nothing would pass every test under it
    expect(used.length).toBeGreaterThan(100)
  })

  test('every id a source file names is a message english says', () => {
    const missing = used.filter(({id}) => !englishIds.has(id)).map(({id, at}) => `${id} (${at})`)

    // an id that no message file has is drawn in the window as it is written
    expect(missing).toEqual([])
  })

  test('every language says the same things as english', () => {
    const sorted = [...english].sort()

    fs.readdirSync(langRoot)
      .filter(file => file.endsWith('.json') && file !== 'en.json')
      .forEach(file => {
        // a language that says less than english draws the ids it lacks
        expect([file, keys(read(path.basename(file, '.json'))).sort()]).toEqual([file, sorted])
      })
  })
})
