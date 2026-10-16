const fs = require('fs')
const path = require('path')

const {matchingFiles, projectFiles} = require('tinkr-core')

/**
 * The project's own files, for an `@` in an AI prompt.
 *
 * A prompt names code the way someone reading the editor would: `@AppServiceProvider`
 * for the class, `@App\Providers\AppServiceProvider` for the one meant when two
 * share a name. The files offered are the project's own — the class index's walk
 * already knows which of composer's directories the project declares and which
 * belong to a vendor package — and one is read whole unless it is too big to be
 * worth sending.
 */

// a prompt carrying whole files is a prompt with a codebase in it: the class the
// question is about is what a model needs, not the project
const maxFile = 24 * 1024
const maxFiles = 3

// `@Name` where a word starts: `ada@example.com` is an address, not a mention
const mention = /(?:^|[\s(])@([A-Za-z_\\][A-Za-z0-9_\\]*)/g

/**
 * The files whose name is the beginning of what is being typed after an `@`.
 *
 * @param {String} projectPath
 * @param {String} typed
 * @return {Array<{name: String, qualified: String, path: String}>} the path as
 * the project writes it, which is what a person reading it expects
 */
const filesFor = (projectPath, typed) => {
  if (!projectPath) {
    return []
  }

  return matchingFiles(projectPath, typed, 8).map(({name, qualified, file}) => ({
    name,
    qualified,
    path: path.relative(projectPath, file),
  }))
}

/**
 * The names a prompt mentions, once each.
 *
 * @param {String} prompt
 * @return {Array<String>}
 */
const mentions = prompt => {
  const found = new Set()

  for (const match of String(prompt || '').matchAll(mention)) {
    found.add(match[1])
  }

  return Array.from(found)
}

/**
 * The files a prompt names, read, for the request to carry.
 *
 * A name the project does not declare is left where it is: the prompt still says
 * `@Whatever`, and the model reads it as a word rather than as a file. Nothing
 * else is sent, so a mention can never quietly become another class's code.
 *
 * @param {String} projectPath
 * @param {String} prompt
 * @return {Array<{name: String, qualified: String, path: String, code: String}>}
 */
const attachmentsFor = (projectPath, prompt) => {
  if (!projectPath) {
    return []
  }

  const files = projectFiles(projectPath)

  return mentions(prompt)
    .map(name => files.find(one => one.qualified === name || one.name === name))
    .filter(Boolean)
    .slice(0, maxFiles)
    .map(({name, qualified, file}) => {
      let code

      try {
        code = fs.readFileSync(file, 'utf8')
      } catch (e) {
        // a file the walk found and the reader cannot open is one to leave out
        return null
      }

      return {
        name,
        qualified,
        path: path.relative(projectPath, file),
        code: code.length > maxFile ? `${code.slice(0, maxFile)}\n// … the rest of this file was not sent` : code,
      }
    })
    .filter(Boolean)
}

module.exports = {
  maxFile,
  maxFiles,
  filesFor,
  mentions,
  attachmentsFor,
}
