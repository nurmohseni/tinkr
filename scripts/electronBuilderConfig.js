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
  // a woff2 inside the asar cannot be read as a file url by the renderer,
  // so the fonts are unpacked beside it
  asarUnpack: ['**/*.woff2', '**/fonts/**'],
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