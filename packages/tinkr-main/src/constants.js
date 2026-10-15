const quickConnection = {
  id: 'quick_connection',
  name: 'Quick Connection',
}

const appName = 'Tinkr'

const protocol = 'tinkr'

// the scheme the renderer is served over: its own, so that a module script has
// an origin it is allowed to load from
const rendererScheme = 'tinkr-app'

module.exports = {
  quickConnection,
  appName,
  protocol,
  rendererScheme,
}
