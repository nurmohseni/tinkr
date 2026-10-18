const {openStore} = require('./store')

const {quickConnection} = require('../constants')

const connections = openStore({
  name: 'app/connections',
  defaults: {
    [quickConnection.id]: quickConnection,
  },
})

module.exports = {
  connections,
}
