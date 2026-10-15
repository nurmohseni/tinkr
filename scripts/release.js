const path = require('path')
const fs = require('fs')
const glob = require('fast-glob')
const {Octokit} = require('@octokit/rest')

const config = require('./config')

const {githubOrg: owner, githubRepo: repo, productName, version} = config

const octokit = new Octokit({
  auth: process.env.GH_TOKEN,
})

/**
 * A release of a version is tagged with the version. A plain push is a build
 * and nothing else, so nothing is published until a version tag is pushed.
 *
 * @return {String}
 */
const getTag = () => `v${version}`

/**
 * @return {Boolean} whether this run should publish a release at all
 */
const isRelease = () => !process.env.GITHUB_SHA || process.env.GITHUB_REF_TYPE === 'tag'

/**
 * Whether the version is a beta.
 *
 * A version carrying a pre-release part — `0.1.0-beta.1` — is one, and it is
 * published as a pre-release: github does not hand it to anyone following the
 * repository's releases, and the app's own updater does not offer it to an
 * installed copy. The plain version that follows it does both.
 *
 * @return {Boolean}
 */
const isPrerelease = () => version.includes('-')

const getOrCreateRelease = async tag => {
  const releaseName = `${productName} ${tag} 📦`
  // a version tag is the only thing that publishes a release, and a version
  // that says beta is published as one
  const prerelease = isPrerelease()
  const body = process.env.GITHUB_SHA
    ? `Built from ${owner}/${repo}@${process.env.GITHUB_SHA.slice(0, 7)}`
    : 'See the changelog in the repository that builds the app'

  try {
    return await octokit.repos.getReleaseByTag({owner, repo, tag})
  } catch (err) {
    // doesn't exist yet
  }

  try {
    return await octokit.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      name: releaseName,
      body,
      draft: false,
      prerelease,
    })
  } catch (err) {
    // the matrix builds the same tag on several systems at once
    return await octokit.repos.getReleaseByTag({owner, repo, tag})
  }
}

const upload = async (releaseId, file) => {
  const name = path.basename(file)
  const data = fs.readFileSync(file)

  const request = () => octokit.request({
    method: 'POST',
    url: 'https://uploads.github.com/repos/:owner/:repo/releases/:id/assets{?name,label}',
    id: releaseId,
    name,
    owner,
    repo,
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    data,
  })

  try {
    await request()
  } catch (err) {
    // building the same commit again uploads the same file names
    const {data: assets} = await octokit.repos.listReleaseAssets({
      owner,
      repo,
      release_id: releaseId,
      per_page: 100,
    })

    const asset = assets.find(a => a.name === name)

    if (!asset) {
      throw err
    }

    await octokit.repos.deleteReleaseAsset({owner, repo, asset_id: asset.id})
    await request()
  }

  console.log(`[release] Uploading ${name}`)
}

const start = async () => {
  if (!isRelease()) {
    console.log('[release] Not a version tag, so this is a build only')
    return
  }

  const tag = getTag()

  console.log(`[release] Releasing ${tag} on ${owner}/${repo}`)

  // globs should only use forward slash, so force use of path.posix
  const distGlob = ext => path.posix.join('build', '**', `*${ext}`)

  const assetGlobs = {
    darwin: [
      distGlob('.zip'),
      distGlob('.dmg'),
      path.posix.join('build/latest-mac.yml'),
    ],
    win32: [path.posix.join('build', 'squirrel-windows', '*'), path.posix.join('build', '*.exe')],
    linux: [
      distGlob('.snap'),
      distGlob('.rpm'),
      distGlob('.deb'),
      distGlob('.AppImage'),
      distGlob('.tar.gz'),
    ],
  }

  const paths = await glob(assetGlobs[process.platform])

  const {data} = await getOrCreateRelease(tag)

  for (const p of paths) {
    await upload(data.id, p)
  }

  console.log(`[release] Release created ${data.html_url}`)
}

if (require.main === module) {
  process.nextTick(async () => {
    try {
      await start()
    } catch ( err ) {
      console.log('[release] ERROR:', err)
      process.exit(1)
    }
  })
}
