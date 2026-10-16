const rootPkg = require('../package.json')

// The workflow runs in a fork as well, and the build has to publish to the
// repository that runs it: actions sets GITHUB_REPOSITORY, so a local release
// falls back to the upstream repository.
const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/')

module.exports = {
  productName: 'Tinkr',
  synopsis: 'A new way to run code. Whether you’re Laravel artisan or not.',
  description: 'A new way to run code: run a snippet in any project or ssh connection, read the result as data, see the queries it sent, and dry-run a write under a transaction.',
  githubOrg: owner || 'nurmohseni',
  githubRepo: repo || 'tinkr',
  version: rootPkg.version,
}
