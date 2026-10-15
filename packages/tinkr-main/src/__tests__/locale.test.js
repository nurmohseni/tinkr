const fs = require('fs')
const path = require('path')

const {getIntl} = require('../locale')
const {allLocales} = require('../utils/allLocales')

test('getIntl should not return null', () => {
  expect(getIntl()).not.toBeNull()
})

const read = locale => JSON.parse(
  fs.readFileSync(path.join(__dirname, '../lang', `${locale}.json`), 'utf8'),
)

/** Every key of a message file, however deep. */
const keys = (messages, at = '') => Object.entries(messages).flatMap(([key, value]) => (
  value !== null && typeof value === 'object' ? keys(value, `${at}${key}.`) : [`${at}${key}`]
))

describe('the message files', () => {
  test('every language says the same things as english', () => {
    const english = keys(read('en')).sort()

    // a language that says less than english is a language with blank rows in it
    expect(english.length).toBeGreaterThan(100)

    allLocales.forEach(locale => {
      expect(keys(read(locale)).sort()).toEqual(english)
    })
  })

  test('every language names every language', () => {
    allLocales.forEach(locale => {
      const messages = read(locale)

      allLocales.forEach(code => {
        expect(typeof messages[code]).toBe('string')
      })
    })
  })
})
