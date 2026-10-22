const path = require('path')

const config = require('./config')

const mainPkg = path.join(__dirname, '../packages/tinkr-main')
const nodePtyDir = path.dirname(require.resolve('node-pty/package.json', {paths: [mainPkg]}))
const rendererPkg = path.join(__dirname, '../packages/tinkr-renderer')
const assetsDir = path.join(__dirname, '../assets')

// the system this build is for: this one, unless one is named (see
// scripts/package.js, which is where the name comes from)
const targetPlatform = process.env.BUILD_PLATFORM || process.platform

module.exports = {
  appId: 'com.tinkr.app',
  productName: config.productName,
  copyright: `Copyright © ${new Date().getFullYear()} Nurullah Mohseni`,

  // a build made for another system cannot compile that system's native modules
  // here: node-gyp refuses to cross-compile. node-pty ships them built for every
  // system and they are N-API, so a build for another system carries the
  // prebuilt ones rather than a rebuild of this machine's.
  npmRebuild: !process.env.BUILD_PLATFORM,

  extraMetadata: {
    name: config.productName,
    description: config.description,
    homepage: `https://github.com/${config.githubOrg}/${config.githubRepo}`,
    author: {
      name: 'Nurullah Mohseni',
      email: '117341570+nurmohseni@users.noreply.github.com',
    },
    repository: {
      url: `https://github.com/${config.githubOrg}/${config.githubRepo}`,
    },
    version: config.version,
  },

  directories: {
    buildResources: assetsDir,
    app: mainPkg,
    output: 'build',
  },
  mac: {
    category: 'public.app-category.developer-tools',
    electronLanguages: ['en', 'zh', 'zh-CN'],
    target: [
      'dmg',
      'zip'
    ],
    // What decides whether the download opens at all. An app that is not signed
    // by a Developer ID and not notarized is reported by macOS as damaged, not
    // as untrusted, so both come from the environment and neither is optional:
    // a certificate in CSC_LINK signs it, and APPLE_ID with
    // APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID notarizes it (see
    // .github/workflows/release.yml, which also refuses to ship one without the
    // other).
    //
    // The hardened runtime is what a notarization ticket is granted against, and
    // electron-builder's default entitlements already carry the three things the
    // app needs signed: JIT and unsigned executable memory for the renderer, and
    // no library validation, which is what lets node-pty load the .node that sits
    // unbundled beside app.asar.
    hardenedRuntime: true,
    notarize: true,
    extendInfo: {
      CFBundleURLSchemes: 'tinkr',
      CFBundleURLName: 'Tinkr Protocol',
    }
  },
  dmg: {
    window: {
      width: 540,
      height: 380,
    },
    contents: [
      {
        x: 130,
        y: 186,
      },
      {
        x: 409,
        y: 186,
        type: 'link',
        path: '/Applications',
      },
    ],
  },
  win: {
    target: [
      'squirrel',
      'portable',
    ],
  },
  linux: {
    synopsis: config.synopsis,
    category: 'Development',
    icon: 'icon.icns',
    target: [
      'AppImage',
      'deb',
      'tar.gz',
      'rpm',
      'snap'
    ],
  },
  // Three things cannot be read from inside an asar and are unpacked beside it:
  // a woff2, which the renderer reads as a file, a native module, which is loaded
  // as a library rather than read, and the MCP server, which a client starts with
  // a plain `node` — nothing in that process can read an asar. The session's pty
  // is the native one, and winpty needs its own two files next to it.
  asarUnpack: [
    '**/mcp-server.js',
    '**/*.woff2',
    '**/fonts/**',
    '**/*.node',
    '**/*.exe',
    '**/*.dll',
  ],
  files: [
    '!**/*',
    {from: mainPkg, filter: ['package.json']},
    // node-pty reads its own files back by a path relative to the code it was
    // read from, and what was read is the bundle: the package's `lib` is `main`
    // here, so what it reaches for is put there.
    //
    // Two of them are its native module — bundled, `__dirname` is `main`, so
    // the bundle looks in `main/build` and `main/prebuilds`, and the package
    // may be hoisted to the workspace root, so it is resolved and copied rather
    // than assumed. A build for another system cannot use this machine's copy:
    // node-gyp cannot cross-compile it (see npmRebuild above), and the package
    // carries one built for every system, so only a build for this one takes
    // it. The winpty files it loads with are the ones beside that module.
    ...(targetPlatform === process.platform
      ? [{from: path.join(nodePtyDir, 'build'), to: 'main/build'}]
      : []),
    {from: path.join(nodePtyDir, 'prebuilds'), to: 'main/prebuilds'},
    // The rest are scripts node-pty starts itself rather than modules it
    // imports, and nothing else can bring them along: the worker that drains
    // the session's output on a thread of its own — which every session on
    // windows starts, whether it runs on winpty or conpty, and which pulls in
    // `shared` with it — the agent that asks which processes a console owns,
    // and what that agent pulls in. A build that leaves the worker out is not
    // told so by the pty: the worker fails to load (`Cannot find module`) and
    // the connection never becomes ready, so the terminal stays empty, a run
    // comes back with nothing and php is not found, while everything that only
    // reads files keeps working.
    {
      from: path.join(nodePtyDir, 'lib'),
      to: 'main',
      filter: [
        'worker/**',
        'shared/**',
        'conpty_console_list_agent.js',
        'utils.js',
      ],
    },
    {from: path.join(mainPkg, 'build'), to: 'main', filter: ['!build/']},
    {from: path.join(rendererPkg, 'build'), to: 'renderer'},
  ],
  electronDownload: {
    mirror: process.env.ELECTRON_MIRROR,
  },
}