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

// what a release says it brings, by the conventional type of the commits in
// it, in this order. Version bumps, tests, ci and the like are not news to
// someone deciding whether to update, so they are left out of the notes; the
// compare link at the end still lists every commit
const sections = [
  {types: ['feat'], title: 'New'},
  {types: ['fix'], title: 'Fixed'},
  {types: ['perf'], title: 'Faster'},
  {types: ['refactor', 'docs'], title: 'Other changes'},
]

// the scopes whose commits are about the repository, not the app
const hiddenScopes = ['e2e', 'test', 'tests', 'ci', 'release']

/**
 * @param {String} text a version tag, `v1.2.3`
 * @return {Array<Number>|null}
 */
const semverOf = text => {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(text)

  return match ? match.slice(1).map(Number) : null
}

const compareVersions = (one, other) => one[0] - other[0] || one[1] - other[1] || one[2] - other[2]

/**
 * The version tag released before this one: the highest one below it.
 *
 * @param {Array<String>} tags
 * @param {String} tag
 * @return {String|null}
 */
const previousTag = (tags, tag) => {
  const current = semverOf(tag)

  return tags
    .map(name => ({name, version: semverOf(name)}))
    .filter(one => one.version && current && compareVersions(one.version, current) < 0)
    .sort((one, other) => compareVersions(other.version, one.version))
    .map(one => one.name)[0] || null
}

/**
 * A commit message as the notes read it: its subject without the type, and the
 * bullets of its body, a wrapped bullet joined back into one line.
 *
 * @param {String} message
 * @return {{type: String, scope: String, subject: String, details: Array<String>}|null}
 */
const parseCommit = message => {
  const [head, ...rest] = message.split('\n')
  const match = /^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(head.trim())

  if (!match) {
    return null
  }

  const details = []

  for (const line of rest) {
    if (/^\s*[-*]\s+/.test(line)) {
      details.push(line.replace(/^\s*[-*]\s+/, '').trim())
    } else if (line.trim() && details.length) {
      details[details.length - 1] += ` ${line.trim()}`
    }
  }

  return {type: match[1].toLowerCase(), scope: (match[2] || '').toLowerCase(), subject: match[3].trim(), details}
}

/**
 * The notes of a release, from the messages of the commits it holds.
 *
 * @param {Array<String>} messages oldest first, as github compares them
 * @return {String} markdown, empty when nothing in it is news
 */
const notesFrom = messages => {
  // a fix to the tests or the pipeline changes nothing a person installs
  const commits = messages.map(parseCommit).filter(commit => commit && !hiddenScopes.includes(commit.scope))

  return sections
    .map(({types, title}) => {
      const items = commits.filter(commit => types.includes(commit.type))

      if (!items.length) {
        return ''
      }

      const lines = items.map(commit => [
        `- ${commit.subject}`,
        ...commit.details.map(detail => `  - ${detail}`),
      ].join('\n'))

      return `### ${title}\n\n${lines.join('\n')}`
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * What changed since the version before this one, read from github itself so a
 * shallow checkout in CI is enough.
 *
 * @param {String} tag
 * @return {Promise<String>}
 */
const changesFor = async tag => {
  const tags = await octokit.paginate(octokit.repos.listTags, {owner, repo, per_page: 100})
  const base = previousTag(tags.map(one => one.name), tag)

  if (!base) {
    return ''
  }

  const {data} = await octokit.repos.compareCommits({owner, repo, base, head: tag})
  const notes = notesFrom(data.commits.map(commit => commit.commit.message))
  const link = `**Full changelog**: https://github.com/${owner}/${repo}/compare/${base}...${tag}`

  return notes ? `${notes}\n\n${link}` : link
}

const getOrCreateRelease = async tag => {
  const releaseName = `${productName} ${tag}`
  // A version tag is the only thing that publishes a release, and it publishes
  // it as *the* release: github only draws a version on the repository's page
  // for a release that is not a pre-release, and a beta whose version says beta
  // is better shown there than a count of tags. The version is the signal.
  const prerelease = false
  // A macOS build that is neither signed by a Developer ID nor notarized is
  // reported by macOS as damaged, not as untrusted, and the dialog offers no way
  // past it. The note stays until a signed release ships. The marker is what the
  // website reads to say the same thing on the download page (tinker-web,
  // src/lib/github.ts), so the two go away together.
  const macNote = `<!-- mac-unsigned -->
> **macOS**: this build is not signed and notarized yet, so macOS reports the app as damaged. Drag Tinkr to Applications, then run this once:
>
> \`\`\`bash
> xattr -dr com.apple.quarantine /Applications/Tinkr.app
> \`\`\``
  const built = process.env.GITHUB_SHA
    ? `Built from ${owner}/${repo}@${process.env.GITHUB_SHA.slice(0, 7)}`
    : 'See the changelog in the repository that builds the app'
  let changes = ''

  try {
    changes = await changesFor(tag)
  } catch (err) {
    // the notes are a courtesy: a release whose commits cannot be read is still
    // a release, and its installers still have to be uploaded
    console.log('[release] Could not read the changes:', err.message)
  }

  const body = `${changes ? `${changes}\n\n` : ''}${built}

${macNote}`

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

/**
 * The name github stores an asset under.
 *
 * Github normalises the name it is handed, and a space is one of the characters
 * it replaces with a dot: `Tinkr Setup 0.1.0-beta.1.exe` is stored as
 * `Tinkr.Setup.0.1.0-beta.1.exe`. Uploading one it already holds under that name
 * is a 422, so the two have to be compared as it would store them — otherwise a
 * build that has to replace its own windows artifacts never finds them, and the
 * release fails on a name the platform changed.
 *
 * @param {String} name
 * @return {String}
 */
const storedName = name => name.replace(/\s+/g, '.')

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

    const asset = assets.find(a => storedName(a.name) === storedName(name))

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
    // the squirrel build reads RELEASES, an nsis one reads latest.yml
    win32: [
      path.posix.join('build', 'squirrel-windows', '*'),
      path.posix.join('build', '*.exe'),
      path.posix.join('build', 'latest.yml'),
    ],
    linux: [
      distGlob('.snap'),
      distGlob('.rpm'),
      distGlob('.deb'),
      distGlob('.AppImage'),
      distGlob('.tar.gz'),
      // an appimage updates from this the way a mac does from latest-mac.yml
      path.posix.join('build', 'latest-linux.yml'),
    ],
  }

  const paths = await glob(assetGlobs[process.platform])

  const {data} = await getOrCreateRelease(tag)

  for (const p of paths) {
    await upload(data.id, p)
  }

  console.log(`[release] Release created ${data.html_url}`)
}

module.exports = {previousTag, parseCommit, notesFrom, changesFor}

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
