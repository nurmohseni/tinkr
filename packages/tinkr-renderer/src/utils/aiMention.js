/**
 * The `@` of an AI prompt: where one is being written, and what naming a file
 * does to the prompt.
 *
 * A mention is what is being typed at the end of the prompt — the last thing
 * there, which is where someone writing one is — so what the list under the
 * prompt can be about is the text after that `@` and nothing else.
 */

/**
 * @param {String} value the prompt
 * @return {{typed: String, at: Number}|null} what follows the `@`, and where the
 * `@` itself is
 */
const mentionAt = value => {
  const found = /(?:^|[\s(])@([A-Za-z_\\][A-Za-z0-9_\\]*)?$/.exec(String(value || ''))

  if (!found) {
    return null
  }

  const typed = found[1] || ''

  return {typed, at: value.length - typed.length - 1}
}

/**
 * The prompt with one file named where the `@` was being written.
 *
 * The whole name is written rather than the short one: two classes can be called
 * the same thing, and the one that was picked is the one that gets sent.
 *
 * @param {String} prompt
 * @param {{typed: String, at: Number}} mention
 * @param {{qualified: String}} file
 * @return {String}
 */
const withMention = (prompt, mention, file) => [
  prompt.slice(0, mention.at),
  `@${file.qualified} `,
  prompt.slice(mention.at + mention.typed.length + 1),
].join('')

export {
  mentionAt,
  withMention,
}
