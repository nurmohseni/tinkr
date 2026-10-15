const rootPkg = require('../package.json')

// The workflow runs in a fork as well, and the build has to publish to the
// repository that runs it: actions sets GITHUB_REPOSITORY, so a local release
// falls back to the upstream repository.
const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/')

module.exports = {
  productName: 'Tinkr',
  synopsis: 'A new way to run code. Whether you’re Laravel artisan or not.',
  description: 'An application that lets you run and manage your Tinker code either locally or via SSH.',
  githubOrg: owner || 'nurmohseni',
  githubRepo: repo || 'tinkr',
  version: rootPkg.version,
}
