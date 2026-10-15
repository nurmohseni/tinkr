const path = require('path')

const config = require('./config')

const mainPkg = path.join(__dirname, '../packages/tinkr-main')
const nodePtyDir = path.dirname(require.resolve('node-pty/package.json', {paths: [mainPkg]}))
const rendererPkg = path.join(__dirname, '../packages/tinkr-renderer')
const assetsDir = path.join(__dirname, '../assets')

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
    // node-pty's binary is a native module the bundle looks for next to itself,
    // and the package may be hoisted to the workspace root, so it is resolved
    {from: path.join(nodePtyDir, 'build'), to: 'main/build'},
    {from: path.join(nodePtyDir, 'prebuilds'), to: 'main/prebuilds'},
    {from: path.join(mainPkg, 'build'), to: 'main', filter: ['!build/']},
    {from: path.join(rendererPkg, 'build'), to: 'renderer'},
  ],
  electronDownload: {
    mirror: process.env.ELECTRON_MIRROR,
  },
}