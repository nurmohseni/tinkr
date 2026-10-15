const electronBuilder = require('electron-builder')
const rimraf = require('rimraf')
const path = require('path')

const electronBuilderConfig = require('./electronBuilderConfig')

const PLATFORM_MAP = {
  darwin: 'mac',
  linux: 'linux',
  win32: 'win',
}

const pkg = () => {
  const config = electronBuilderConfig
  // a build is for the system it runs on unless one is named. electron-builder
  // can make another system's installers, which is how a windows build is made
  // from here instead of waiting for a windows machine
  const targetPlatform = PLATFORM_MAP[process.env.BUILD_PLATFORM || process.platform]

  const target = process.env.BUILD_TARGETS
    ? process.env.BUILD_TARGETS.split(',')
    : config[targetPlatform].target

  return electronBuilder.build({
    config,
    // scripts/release.js uploads the build, and electron-builder's own
    // publisher failed on the mac runner trying to spawn /usr/bin/python
    publish: 'never',
    [targetPlatform]: target,
  })
}

const emptyDir = async dir => {
  return new Promise((resolve, reject) => {
    rimraf(dir, err => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

module.exports.start = async () => {
  console.log('[package] Removing existing directories')
  await emptyDir(path.join(__dirname, '../build/**/*'))
  console.log('[package] Packaging app')
  await pkg()
  console.log('[package] Complete!')
}

if (require.main === module) {
  process.nextTick(async () => {
    try {
      await module.exports.start()
    } catch ( err ) {
      console.error('[package] ERROR:', err)
      process.exit(1)
    }
  })
}
