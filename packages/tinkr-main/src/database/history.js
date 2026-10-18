const {openStore} = require('./store')

const data = {}

const history = id => {
  if (data[id]) {
    return data[id]
  }

  const store = openStore({
    name: `app/history/${id}`,
    // the file is rewritten whole on every run, and it holds code: indenting it
    // is a cost every run pays for a file nobody reads by hand
    serialize: value => JSON.stringify(value),
  })

  data[id] = store

  return store
}

module.exports = {
  history,
}
