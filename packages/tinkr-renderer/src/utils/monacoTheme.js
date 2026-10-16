/**
 * Monaco paints its own chrome, so it is themed from the design's own tokens:
 * the well it sits in, the gutter, the caret, the current-line band and the
 * syntax colours are the ones tinkr.css paints the code well with.
 *
 * The tokens are read off the document instead of passed in, and the theme is
 * re-read when `data-theme` changes — that attribute is the theme switch for
 * the whole app, and it is already set on the first paint.
 */

import {colour, token} from './cssColor'

const THEME = 'tinkr'

const rules = () => [
  // the php-snippet grammar emits keyword.php, number.float.php, string.php and
  // the rest; monaco matches a rule against the head of the token
  {token: 'keyword', foreground: colour('--code-keyword')},
  // true, false, null and the constants a run reaches for, which the grammar
  // emits as constant.php
  {token: 'constant', foreground: colour('--code-const')},
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
    // the design's ::selection tint, so the editor selects in the same verdigris
    'editor.selectionBackground': colour('--selection'),
    // the completion list is a floating layer like a menu, and monaco's own
    // palette would leave it grey against the paper
    'editorSuggestWidget.background': colour('--panel-raised'),
    'editorWidget.background': colour('--panel-raised'),
    'editorHoverWidget.background': colour('--panel-raised'),
    'editorSuggestWidget.border': colour('--border-strong'),
    'editorHoverWidget.border': colour('--border-strong'),
    'editorSuggestWidget.foreground': colour('--text'),
    'editorSuggestWidget.selectedForeground': colour('--text'),
    'editorSuggestWidget.selectedBackground': colour('--primary-soft'),
    'editorSuggestWidget.highlightForeground': colour('--accent'),
    'editorIndentGuide.background1': colour('--border'),
  }

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

  // monaco measures its glyphs when the editor is created, which is before the
  // mono face lands; remeasuring once it is in keeps the caret on a character
  document.fonts.ready.then(() => monaco.editor.remeasureFonts())

  return () => observer.disconnect()
}
