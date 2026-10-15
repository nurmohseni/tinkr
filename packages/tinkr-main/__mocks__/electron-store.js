// electron-store writes to the user data directory of a running app, which
// jest does not have: the same interface over a plain object is enough for
// the modules that read and write settings
class Store {
  constructor (options = {}) {
    this.store = Object.assign({}, options.defaults)
  }

  get (key, fallback) {
    return this.store[key] === undefined ? fallback : this.store[key]
  }

  set (key, value) {
    this.store[key] = value
  }

  has (key) {
    return this.store[key] !== undefined
  }

  delete (key) {
    delete this.store[key]
  }
}

module.exports = Store
