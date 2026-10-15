const {allLocales} = require('../allLocales')

test('allLocales should be every language the app ships', () => {
  expect(allLocales).toEqual([
    'de', 'en', 'es', 'pt', 'zh',
  ])
})

test('allLocales should read the same way every launch', () => {
  expect([...allLocales].sort()).toEqual(allLocales)
})
