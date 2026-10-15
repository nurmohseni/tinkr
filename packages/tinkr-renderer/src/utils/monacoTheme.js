/**
 * Monaco paints its own chrome, so it is themed from the design's own tokens:
 * the well it sits in, the gutter, the caret, the current-line band and the
 * syntax colours are the ones tinkr.css paints the code well with.
 *
 * The tokens are read off the document instead of passed in, and the theme is
 * re-read when `data-theme` changes — that attribute is the theme switch for
 * the whole app, and it is already set on the first paint.
 */

const THEME = 'tinkr'

const token = name => window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/**
 * Monaco parses theme colours as hex, and the design's current-line band is an
 * rgba() token, so the colour is converted on the way in.
 *
 * @param {String} value a css colour: hex, rgb() or rgba()
 * @return {String} the same colour as #rrggbb or #rrggbbaa
 */
const toHex = value => {
  const parts = value.match(/^rgba?\(([^)]+)\)$/)

  if (!parts) {
    return value
  }

  const [r, g, b, alpha = 1] = parts[1].split(',').map(part => parseFloat(part))
  const channels = alpha < 1 ? [r, g, b, alpha * 255] : [r, g, b]

  return `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

/**
 * A design token as the hex monaco parses, or undefined when the palette does
 * not declare it — a missing colour is left out of the theme rather than
 * guessed at.
 *
 * @param {String} name
 * @return {String|undefined}
 */
const colour = name => {
  const value = token(name)

  return value ? toHex(value) : undefined
}

const rules = () => [
  // the php-snippet grammar emits keyword.php, number.float.php, string.php and
  // the rest; monaco matches a rule against the head of the token
  {token: 'keyword', foreground: colour('--code-keyword')},
  {token: 'constant', foreground: colour('--code-num')},
  {token: 'number', foreground: colour('--code-num')},
  {token: 'string', foreground: colour('--code-str')},
  {token: 'comment', foreground: colour('--code-comment'), fontStyle: 'italic'},
  {token: 'variable', foreground: colour('--code-var')},
  {token: 'delimiter', foreground: colour('--code-op')},
  // the grammar does not tell a method name from a class name, and the design
  // paints method names with --code-fn
  {token: 'identifier', foreground: colour('--code-fn')},
]

const colors = () => {
  const map = {
    'editor.background': colour('--panel-inset'),
    'editorGutter.background': colour('--panel-inset'),
    'editor.foreground': colour('--text'),
    'editorLineNumber.foreground': colour('--code-line'),
    'editorLineNumber.activeForeground': colour('--code-line-active'),
    'editor.lineHighlightBackground': colour('--code-caret-line'),
    'editor.lineHighlightBorder': '#00000000',
    'editorCursor.foreground': colour('--accent'),
    // the design's ::selection tint, so the editor selects in the same indigo
    'editor.selectionBackground': colour('--selection'),
  }

  // the suggestion popup is left to monaco's own dark palette: theming it from
  // the tokens left its text and background indistinguishable, and a readable
  // popup matters more than one that matches the panels
  return Object.fromEntries(Object.entries(map).filter(([, value]) => value))
}

/**
 * The code well's type: the design's 13px mono on 1.6, as numbers for monaco.
 *
 * @return {{fontFamily: String, fontSize: Number, lineHeight: Number}}
 */
export const editorFont = () => {
  // both tokens are the app's own, declared in global.css, so the code size is
  // set in one place and no second literal can drift from it
  const fontSize = parseFloat(token('--editor-font-size'))
  const lineHeight = parseFloat(token('--lh-code'))

  return {
    fontFamily: token('--font-mono'),
    fontSize,
    lineHeight: Math.round(fontSize * lineHeight),
  }
}

/**
 * Define the theme for the current palette and select it.
 *
 * @param {monaco} monaco
 */
export const defineEditorTheme = monaco => {
  monaco.editor.defineTheme(THEME, {
    base: document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: rules(),
    colors: colors(),
  })

  monaco.editor.setTheme(THEME)
}

/**
 * Select the theme, and re-select it when the palette changes.
 *
 * @param {monaco} monaco
 * @return {Function} dispose the watcher
 */
export const watchEditorTheme = monaco => {
  defineEditorTheme(monaco)

  const observer = new window.MutationObserver(() => defineEditorTheme(monaco))

  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']})

  return () => observer.disconnect()
}
