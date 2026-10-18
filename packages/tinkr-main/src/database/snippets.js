const {openStore} = require('./store')

const data = {}

const snippets = id => {
  if (data[id]) {
    return data[id]
  }

  const store = openStore({
    name: `app/snippets/${id}`,
  })

  data[id] = store

  return store
}

module.exports = {
  snippets,
}
