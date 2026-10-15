const Store = require('electron-store')

const data = {}

const history = id => {
  if (data[id]) {
    return data[id]
  }

  const store = new Store({
    name: `app/history/${id}`,
  })

  data[id] = store

  return store
}

module.exports = {
  history,
}
