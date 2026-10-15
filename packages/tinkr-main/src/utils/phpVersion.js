// what `php -v` writes first: `PHP 8.5.11 (cli) (built: …)`, and the version can
// carry a package suffix on a distribution's build: `8.1.2-1ubuntu2.14`
const version = /\bPHP\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/

/**
 * The version a session answered with, or null when nothing answered with one.
 *
 * A shell that has no php says so in its own words — `php: command not found` —
 * and a connection that never got that far says nothing at all, so the parse is
 * the only thing that decides: no version in the text is no php.
 *
 * @param {String} output
 * @return {String|null}
 */
const phpVersionOf = output => {
  const found = version.exec(String(output || ''))

  return found ? found[1] : null
}

module.exports = {
  phpVersionOf,
}
