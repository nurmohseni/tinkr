const fs = require('fs')
const path = require('path')

// sorted, because it is what the language row lists and what the app matches a
// system locale against: the order a directory happens to read in is not one
const allLocales = fs
  .readdirSync(path.join(__dirname, '../lang'))
  .map(v => path.basename(v, '.json'))
  .sort()

module.exports = {
  allLocales,
}
