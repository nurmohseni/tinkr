/** What the app puts on the clipboard: a value as the json it is drawn from. */
export const copy = value => copyText(
  typeof value === 'string' ? value : JSON.stringify(value, null, 2),
)

/** What the app puts on the clipboard, verbatim. */
export const copyText = text => navigator.clipboard.writeText(text)
