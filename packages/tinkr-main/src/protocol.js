const {app, protocol: electronProtocol} = require('electron')
const path = require('path')
const fs = require('fs')
const {URL} = require('url')

const {getConnection, connectConnection} = require('./services/connections')
const {protocol, rendererScheme} = require('./constants')

// The renderer used to be read from a file:// url, and on windows a module
// script is not allowed to load from one: the origin is opaque there, so the
// app's own script was blocked before it ran and the window stayed blank with
// nothing in the log to say so. It is served over a scheme of the app's own
// instead, which is an origin a module may load from.

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  // Commit Mono's italic comments are the one face that is not a woff2
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
}

electronProtocol.registerSchemesAsPrivileged([
  {
    scheme: rendererScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
])

/**
 * Answer the renderer's own urls from the app's renderer directory.
 *
 * The directory is inside the asar, which only electron's own fs understands,
 * so the file is read rather than fetched.
 */
const serveRenderer = () => {
  const rendererDir = path.join(app.getAppPath(), 'renderer')

  electronProtocol.handle(rendererScheme, async request => {
    const {pathname} = new URL(request.url)
    const file = path.join(rendererDir, decodeURIComponent(pathname))

    return new Response(await fs.promises.readFile(file), {
      headers: {
        'content-type': types[path.extname(file)] || 'application/octet-stream',
      },
    })
  })
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(protocol)
}

app.on('open-url', (event, url) => {
  const urlInstance = new URL(url)
  const id = urlInstance.host

  app.whenReady().then(async () => {
    await connectConnection(getConnection(id))
  })
})

module.exports = {
  serveRenderer,
}
